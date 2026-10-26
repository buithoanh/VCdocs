// Chat19: point integration_openai at the host Ollama (through the ai19 relay,
// OpenAI-compatible /v1, no API key, CPU-only alias) and reduce the Assistant to
// read-only text tasks: ask / chat, summarise, headline, topics, draft
// (context write, reformulate, change tone, proofread). Every other task type
// (chat-with-tools used by Context Agent, Context Agent interaction, images,
// speech, audio chat, translation, stickers…) is disabled through the core
// TaskProcessing type preferences, and the matching pickers are switched off.
// Only occ (app config). Records the resulting config without secrets.
import { client, occ, ocs, ollamaRelayUrl, tp, writeEvidence } from './lib.mjs';

const model = 'vcws-qwen3-4b-cpu:latest';
const openai = {
  url: ollamaRelayUrl,
  service_name: 'Ollama local (chat19, CPU)',
  api_key: '',
  default_completion_model_id: model,
  chat_endpoint_enabled: '1',
  request_timeout: '900',
  max_tokens: '1024',
  llm_provider_enabled: '1',
  translation_provider_enabled: '0',
  t2i_provider_enabled: '0',
  stt_provider_enabled: '0',
  tts_provider_enabled: '0',
  analyze_image_provider_enabled: '0',
};
for (const [key, value] of Object.entries(openai)) await occ('config:app:set', 'integration_openai', key, `--value=${value}`);
const assistant = {
  assistant_enabled: '1',
  free_prompt_picker_enabled: '1',
  text_to_image_picker_enabled: '0',
  speech_to_text_picker_enabled: '0',
  text_to_sticker_picker_enabled: '0',
};
for (const [key, value] of Object.entries(assistant)) await occ('config:app:set', 'assistant', key, `--value=${value}`);

// Read-only allow-list. Anything not listed is disabled, including types that
// appear later (re-run this script after installing any AI app).
const allow = new Set([
  'core:text2text', 'core:text2text:chat', 'core:text2text:summary', 'core:text2text:headline',
  'core:text2text:topics', 'core:contextwrite', 'core:text2text:reformulation', 'core:text2text:changetone',
  'core:text2text:proofread',
]);
const admin = await client('admin13');
const all = ocs(await admin.request('GET', tp('/tasktypes?showDisabled=1')))?.types ?? {};
const prefs = {};
for (const id of Object.keys(all)) prefs[id] = allow.has(id);
// Also pin known write/agent-capable ids even if no provider is registered now.
for (const id of ['core:generateemoji', 'assistant:text2sticker', 'core:text2text:chatwithtools', 'core:contextagent:interaction', 'core:contextagent:audio-interaction', 'core:text2image', 'core:audio2text', 'core:text2speech', 'core:audio2audio:chat', 'core:analyze-images', 'core:translate', 'context_chat:context_chat', 'context_chat:context_chat_search']) prefs[id] = false;
for (const [id, enabled] of Object.entries(prefs)) await occ('taskprocessing:task-type:set-enabled', id, enabled ? '1' : '0');
// The available-type list is cached 60 s in the distributed cache (DOC
// Manager::getAvailableTaskTypes): wait until users see only the allow-list.
let enabledNow = {};
for (let i = 0; i < 40; i += 1) {
  enabledNow = ocs(await admin.request('GET', tp('/tasktypes')))?.types ?? {};
  if (Object.keys(enabledNow).every((id) => allow.has(id))) break;
  await new Promise((r) => setTimeout(r, 3000));
}
if (!Object.keys(enabledNow).every((id) => allow.has(id))) throw new Error(`TASK_TYPES_NOT_RESTRICTED:${Object.keys(enabledNow).join(',')}`);
const readBack = {};
for (const key of [...Object.keys(openai), 'api_key_set']) {
  if (key === 'api_key' || key === 'api_key_set') continue;
  readBack[key] = (await occ('config:app:get', 'integration_openai', key)).stdout.trim();
}
const typePrefs = JSON.parse((await occ('config:app:get', 'core', 'ai.taskprocessing_type_preferences')).stdout.trim() || '{}');
await writeEvidence('assistant-config.json', {
  integrationOpenai: readBack,
  apiKey: 'empty (Ollama needs none; nothing stored)',
  assistant,
  taskTypesSeenWithShowDisabled: Object.keys(all).sort(),
  taskTypePreferences: typePrefs,
  enabledTaskTypesForUsers: Object.keys(enabledNow).sort(),
  disabledByPreference: Object.keys(prefs).filter((id) => !prefs[id]).sort(),
});
console.log(`enabled: ${Object.keys(enabledNow).sort().join(', ')}`);
console.log(`disabled: ${Object.keys(prefs).filter((id) => !prefs[id]).sort().join(', ')}`);
