// Chat17: in-page WebRTC harness, evaluated in each headless Chrome on a
// same-origin Nextcloud page (http://localhost:18130/status.php). It speaks
// Talk's *internal* signaling exactly like the Talk web client does when no
// HPB is configured: join room (participants/active) → join call (call/{token})
// → long-poll GET signaling/{token}, send offer/answer/candidate as
// {ev:"message", fn:"<json>", sessionId}. Media = Chrome fake devices.
// Authorization is injected by CDP (Network.setExtraHTTPHeaders); the harness
// never sees credentials. Results are exposed on window.__talk17.
(() => {
  const ocs = '/ocs/v2.php/apps/spreed/api';
  const T = { log: [], t0: performance.now(), session: null, peers: {}, users: [], errors: [], received: [], pulls: 0 };
  window.__talk17 = T;
  const now = () => Math.round(performance.now() - T.t0);
  const mark = (what, extra = {}) => T.log.push({ at: now(), what, ...extra });
  const api = async (method, path, body) => {
    const r = await fetch(`${ocs}${path}`, {
      method,
      headers: { 'OCS-APIRequest': 'true', Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    let data = null;
    try { data = (await r.json()).ocs?.data; } catch { /* no json */ }
    return { status: r.status, data };
  };
  const sendSignal = (token, to, type, payload) => {
    const fn = JSON.stringify({ to, sid: T.sid, roomType: 'video', type, payload });
    const body = new URLSearchParams({ messages: JSON.stringify([{ ev: 'message', fn, sessionId: T.session }]) });
    return fetch(`${ocs}/v3/signaling/${token}`, { method: 'POST', headers: { 'OCS-APIRequest': 'true', Accept: 'application/json' }, body, credentials: 'same-origin' });
  };
  const pc = (token, remote) => {
    if (T.peers[remote]) return T.peers[remote].pc;
    const p = new RTCPeerConnection({ iceServers: T.iceServers });
    const peer = { pc: p, candidatesSent: 0, candidateTypes: {}, created: now() };
    T.peers[remote] = peer;
    T.stream.getTracks().forEach((track) => p.addTrack(track, T.stream));
    p.onicecandidate = (e) => {
      if (!e.candidate) return;
      peer.candidatesSent += 1;
      const typ = / typ (\w+)/.exec(e.candidate.candidate)?.[1] ?? '?';
      peer.candidateTypes[typ] = (peer.candidateTypes[typ] ?? 0) + 1;
      sendSignal(token, remote, 'candidate', { candidate: { candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex } });
    };
    p.onconnectionstatechange = () => mark(`pc:${p.connectionState}`, { remote });
    p.oniceconnectionstatechange = () => mark(`ice:${p.iceConnectionState}`, { remote });
    p.ontrack = (e) => mark(`track:${e.track.kind}`, { remote });
    return p;
  };
  const handle = async (token, msg) => {
    const m = typeof msg.data === 'string' ? JSON.parse(msg.data) : msg.data;
    T.received.push({ at: now(), type: m.type, from: m.from });
    const p = pc(token, m.from);
    const peer = T.peers[m.from];
    // The callee's candidates can reach the server before its answer (both are
    // separate POSTs), so buffer candidates until a remote description exists.
    const flush = async () => {
      for (const c of peer.pending ?? []) await p.addIceCandidate(c).catch((e) => T.errors.push(`cand:${e.message}`));
      peer.pending = [];
    };
    if (m.type === 'offer') {
      await p.setRemoteDescription({ type: 'offer', sdp: m.payload.sdp });
      await flush();
      const answer = await p.createAnswer();
      await p.setLocalDescription(answer);
      mark('answer-sent', { to: m.from });
      await sendSignal(token, m.from, 'answer', { type: 'answer', sdp: answer.sdp });
    } else if (m.type === 'answer') {
      mark('answer-received', { from: m.from });
      await p.setRemoteDescription({ type: 'answer', sdp: m.payload.sdp });
      await flush();
    } else if (m.type === 'candidate') {
      if (!p.remoteDescription) (peer.pending ??= []).push(m.payload.candidate);
      else await p.addIceCandidate(m.payload.candidate).catch((e) => T.errors.push(`cand:${e.message}`));
    }
  };
  T.pullLoop = async (token) => {
    const loop = (T.loopId = (T.loopId ?? 0) + 1);
    T.pulling = true;
    while (T.pulling && loop === T.loopId) {
      const r = await api('GET', `/v3/signaling/${token}`).catch((e) => ({ status: 0, data: null, e }));
      T.pulls += 1;
      if (r.status !== 200) { T.errors.push(`pull:${r.status}`); await new Promise((s) => setTimeout(s, 500)); continue; }
      for (const item of r.data ?? []) {
        if (item.type === 'usersInRoom') T.users = item.data.map((u) => ({ sessionId: u.sessionId, inCall: u.inCall, userId: u.userId }));
        else if (item.type === 'message') await handle(token, item).catch((e) => T.errors.push(`handle:${e.message}`));
      }
    }
  };
  T.prepare = async (token) => {
    T.sid = String(Date.now());
    const settings = await api('GET', `/v3/signaling/settings?token=${token}`);
    T.settings = { status: settings.status, stun: settings.data?.stunservers ?? null, turn: (settings.data?.turnservers ?? []).length, server: settings.data?.server ?? '' };
    T.iceServers = [...(settings.data?.stunservers ?? []), ...(settings.data?.turnservers ?? [])];
    try {
      // Fake camera via Chrome flags; the fake *microphone* cannot start in
      // headless Chrome on macOS here (NotReadableError), so audio is a WebAudio
      // oscillator track — still a real Opus RTP stream for the call.
      const video = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const dest = ctx.createMediaStreamDestination();
      osc.connect(dest);
      osc.start();
      await ctx.resume();
      T.stream = new MediaStream([...video.getVideoTracks(), ...dest.stream.getAudioTracks()]);
      T.audioSource = 'webaudio-oscillator';
    } catch (e) {
      T.errors.push(`gum:${e.name}:${e.message}`);
      return { ...T.settings, error: `getUserMedia ${e.name}: ${e.message}`, secure: window.isSecureContext, origin: location.origin };
    }
    mark('media-ready');
    return T.settings;
  };
  T.join = async (token, password) => {
    const j = await api('POST', `/v4/room/${token}/participants/active`, { force: true, ...(password ? { password } : {}) });
    T.session = j.data?.sessionId ?? null;
    mark('room-joined', { status: j.status });
    const c = await api('POST', `/v4/call/${token}`, { flags: 3 });
    mark('call-joined', { status: c.status });
    T.pullLoop(token);
    return { room: j.status, call: c.status, hasSession: Boolean(T.session) };
  };
  T.offer = async (token, remote) => {
    const p = pc(token, remote);
    const offer = await p.createOffer();
    await p.setLocalDescription(offer);
    mark('offer-sent', { to: remote });
    await sendSignal(token, remote, 'offer', { type: 'offer', sdp: offer.sdp });
  };
  T.stats = async () => {
    const out = {};
    for (const [remote, peer] of Object.entries(T.peers)) {
      const s = await peer.pc.getStats();
      const r = { connectionState: peer.pc.connectionState, candidateTypes: peer.candidateTypes, inbound: {}, selectedPair: null };
      s.forEach((v) => {
        if (v.type === 'inbound-rtp') r.inbound[v.kind] = { bytes: v.bytesReceived, packets: v.packetsReceived, frames: v.framesDecoded ?? null };
        if (v.type === 'candidate-pair' && v.nominated && v.state === 'succeeded') r.selectedPair = { rttMs: v.currentRoundTripTime != null ? Math.round(v.currentRoundTripTime * 1000) : null, local: v.localCandidateId, remote: v.remoteCandidateId };
      });
      if (r.selectedPair) {
        const l = s.get(r.selectedPair.local); const rm = s.get(r.selectedPair.remote);
        r.selectedPair.localType = l?.candidateType; r.selectedPair.remoteType = rm?.candidateType; r.selectedPair.protocol = l?.protocol;
        r.selectedPair.localIsPrivate = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|::1|fe80|fd)/.test(l?.address ?? '') || /\.local$/.test(l?.address ?? '');
        delete r.selectedPair.local; delete r.selectedPair.remote;
      }
      out[remote] = r;
    }
    return out;
  };
  T.leave = async (token) => {
    T.pulling = false;
    for (const peer of Object.values(T.peers)) peer.pc.close();
    T.peers = {};
    await api('DELETE', `/v4/call/${token}`);
    await api('DELETE', `/v4/room/${token}/participants/active`);
    T.stream?.getTracks().forEach((t) => t.stop());
    mark('left');
  };
})();
