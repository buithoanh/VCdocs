import { htmlToText, safeLinkHref, sanitizeHtml } from '../src/modules/mail-basic/html-sanitizer';

const LINK = (href: string, text: string) => `<a href="${href}" rel="noopener noreferrer" target="_blank">${text}</a>`;

describe('sanitizeHtml allowlist (thay regex, review O14)', () => {
  it('giữ định dạng hợp lệ và chuẩn hoá link', () => {
    const input = '<p><strong>Đậm</strong> <b>b</b> <em>nghiêng</em> <i>i</i> <u>gạch dưới</u> <s>gạch</s> <strike>cũ</strike></p>'
      + '<ul><li>một</li></ul><ol><li>hai</li></ol><blockquote>trích</blockquote><h2>H2</h2><h3>H3</h3><pre><code>a &lt; b</code></pre>'
      + '<div>dòng<br>mới</div><a href="https://vcworkspace.test/a?b=1&amp;c=2" title="t" class="x">link</a> <a href="mailto:nv@vcworkspace.test">thư</a>';
    expect(sanitizeHtml(input)).toBe('<p><strong>Đậm</strong> <b>b</b> <em>nghiêng</em> <i>i</i> <u>gạch dưới</u> <s>gạch</s> <s>cũ</s></p>'
      + '<ul><li>một</li></ul><ol><li>hai</li></ol><blockquote>trích</blockquote><h2>H2</h2><h3>H3</h3><pre><code>a &lt; b</code></pre>'
      + `<div>dòng<br>mới</div>${LINK('https://vcworkspace.test/a?b=1&amp;c=2', 'link')} ${LINK('mailto:nv@vcworkspace.test', 'thư')}`);
  });

  it.each([
    ['svg onload', '<svg onload=alert(1)><circle/></svg>ok', 'ok'],
    ['svg chứa script và link', '<svg><a href="javascript:alert(1)"><text>x</text></a><script>alert(1)</script></svg>sau', 'sau'],
    ['math', '<math><mi xlink:href="javascript:alert(1)">x</mi></math>y', 'y'],
    ['template', '<template><img src=x onerror=alert(1)></template>z', 'z'],
    ['script', 'a<script>alert(1)</script>b<SCRIPT src="//x"></SCRIPT>c', 'abc'],
    ['style', '<style>body{background:url(javascript:alert(1))}</style>t', 't'],
    ['iframe', '<iframe src="https://evil.test"></iframe><iframe srcdoc="<script>alert(1)</script>">x</iframe>k', 'k'],
    ['object/embed', '<object data="x.swf"><param name=a value=b>fallback</object><embed src=x>e', 'e'],
    ['img onerror', '<img src=x onerror=alert(1)>', ''],
    ['sự kiện trên thẻ cho phép', '<p onclick="alert(1)" onmouseover=alert(2) style="x:expression(alert(3))">p</p>', '<p>p</p>'],
    ['href không ngoặc javascript', '<a href=javascript:alert(1)>x</a>', 'x'],
    ['href entity java&#115;cript', '<a href="java&#115;cript:alert(1)">x</a>', 'x'],
    ['href entity hex và không chấm phẩy', '<a href="&#x6A;avascript&#58alert(1)">x</a>', 'x'],
    ['href có tab/xuống dòng', '<a href="jav&#x09;ascript:alert(1)">x</a><a href="java\nscript:alert(1)">y</a>', 'xy'],
    ['href khoảng trắng và điều khiển đầu', '<a href="  &#1;javascript:alert(1)">x</a>', 'x'],
    ['vbscript', '<a href="vbscript:msgbox(1)">x</a>', 'x'],
    ['data URL', '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>', 'x'],
    ['giao thức tương đối', '<a href="//evil.test/x">x</a><a href="/relative">y</a><a href="https:/\\evil">z</a>', 'xy' + LINK('https://evil/', 'z')],
    ['https không host', '<a href="https://">x</a>', 'x'],
    ['thông tin đăng nhập trong URL', '<a href="https://user:pw@evil.test">x</a>', 'x'],
    ['comment và CDATA', '<!-- <script>alert(1)</script> -->a<![CDATA[<img src=x onerror=alert(1)>]]>b', 'ab'],
    ['thẻ lạ giữ chữ', '<span style="x">chữ</span><font color=red>màu</font><table><tr><td>ô</td></tr></table>', 'chữmàuô'],
    ['form/input/button', '<form action="https://evil"><input value="x"><button formaction=javascript:alert(1)>b</button></form>', 'b'],
    ['markup lồng/vỡ', '<b><i>x</b>y</i><p>z', '<b><i>x</i></b>y<p>z</p>'],
    ['thẻ đóng thừa', '</b></a></p>t</div>', '<p></p>t'],
    ['thuộc tính không đóng', '<a href="https://ok.test" onclick="x>y</a>z', ''],
    ['escape văn bản', '<p>1 &lt; 2 &amp; "q" \'s\' &gt;</p>', '<p>1 &lt; 2 &amp; &quot;q&quot; &#39;s&#39; &gt;</p>'],
    ['chữ hoa', '<P ONCLICK=x><A HREF="HTTPS://OK.TEST/A">x</A></P>', `<p>${LINK('https://ok.test/A', 'x')}</p>`],
    ['meta/base/link', '<base href="https://evil/"><meta http-equiv=refresh content="0;url=javascript:alert(1)"><link rel=stylesheet href=x>t', 't'],
  ])('%s', (_label, input, expected) => {
    expect(sanitizeHtml(input)).toBe(expected);
  });

  it('không bao giờ còn dấu hiệu thực thi trong đầu ra (fuzz đơn giản)', () => {
    const pieces = ['<', '>', '"', "'", '=', '/', 'a', 'href', 'javascript:', 'on', 'error', 'svg', 'script', 'img', ' ', '&#', '106;', '\n', 'p', 'iframe', 'style'];
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
    for (let n = 0; n < 2000; n++) {
      let input = '';
      for (let k = 0; k < 30; k++) input += pieces[rnd() % pieces.length];
      const out = sanitizeHtml(input);
      expect(out).not.toMatch(/<(?!\/?(p|br|div|strong|b|em|i|u|s|ul|ol|li|blockquote|h2|h3|code|pre|a)[ >])/i);
      // "javascript:" chỉ được phép còn lại dưới dạng chữ đã escape, không bao giờ trong thuộc tính.
      for (const [, href] of out.matchAll(/href="([^"]*)"/g)) expect(href).toMatch(/^(https?:\/\/[^/]|mailto:)/);
      expect(out.replace(/<a href="[^"]*" rel="noopener noreferrer" target="_blank">/g, '<a>')).not.toMatch(/<[a-z0-9]+\s/i);
      expect(out).not.toMatch(/<(script|svg|iframe|style|img)/i);
    }
  });

  it('giới hạn kích thước và vẫn cân thẻ', () => {
    const out = sanitizeHtml(`<p><b>${'x'.repeat(5000)}</b></p>`, 200);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.startsWith('<p><b>')).toBe(true);
    expect(out.endsWith('</b></p>')).toBe(true);
    const deep = sanitizeHtml(`${'<div>'.repeat(500)}x${'</div>'.repeat(500)}`);
    expect((deep.match(/<div>/g) ?? []).length).toBe(40);
    expect((deep.match(/<\/div>/g) ?? []).length).toBe(40);
  });

  it('safeLinkHref chỉ nhận http/https/mailto', () => {
    expect(safeLinkHref(' https://vcworkspace.test ')).toBe('https://vcworkspace.test/');
    expect(safeLinkHref('mailto:a@vcworkspace.test')).toBe('mailto:a@vcworkspace.test');
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', 'vbscript:x', 'file:///etc/passwd', '//evil.test', 'relative', '', 'ftp://x.test'])
      expect(safeLinkHref(bad)).toBeNull();
  });

  it('htmlToText lấy văn bản, bỏ nội dung script/style', () => {
    expect(htmlToText('<p>Xin <b>chào</b></p><script>bad()</script><style>x</style>&amp;').replace(/\s+/g, ' ').trim()).toBe('Xin chào &');
  });
});
