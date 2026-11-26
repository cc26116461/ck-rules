// CK的规矩 —— 把对话规矩注入系统提示，并提供执行权限档位与状态面板。
// 只用官方 systemPrompt.section() 与 webServer 路由，不改宿主文件、不打补丁。
// 面板里改的档位和称呼走官方的 configEditor，写进当前 profile 的 cordis.patch.yml，
// 由 Loader 重启本插件完成热更新，不需要编辑文件、不需要重启 DSH。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ORDER = 450; // 紧跟 persona 之后、计划模式策略之前
const VERSION = '0.3.0';
const MAX_OWNER_CHARS = 24;
const MAX_BODY_BYTES = 16 * 1024;

export const inject = ['systemPrompt'];

const MODE_TEXT = {
  loose: '执行权限：宽松。只读操作直接做；写文件、改配置、跑命令也直接做，做完再说明。',
  standard:
    '执行权限：标准。只读操作直接做；写文件、改配置、删除、跑有副作用的命令之前，先用一句话说明要做什么、动哪里，等确认再动。',
  strict:
    '执行权限：严格。每一步都先说明并等确认，读文件、写文件、跑命令都一样；不要连续自动执行多个步骤。',
};

const MODE_LABEL = { loose: '宽松', standard: '标准', strict: '严格' };
const MODES = ['loose', 'standard', 'strict'];

function resolvePromptFile(config) {
  return config.promptFile
    ? path.resolve(String(config.promptFile))
    : path.join(HERE, 'prompt', 'default.md');
}

function readPrompt(config) {
  const file = resolvePromptFile(config);
  try {
    return { text: fs.readFileSync(file, 'utf8'), file };
  } catch (error) {
    return { text: '', file, error };
  }
}

function normalizeMode(mode) {
  return MODE_TEXT[mode] ? mode : 'standard';
}

function normalizeOwner(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('请求内容太大');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

export function apply(ctx, config = {}) {
  const enabled = config.enabled !== false;
  const order = Number.isFinite(config.order) ? Number(config.order) : DEFAULT_ORDER;
  const prompt = readPrompt(config);

  // 当前生效值。面板改完先落配置，再由 Loader 重启本插件重建这一段。
  const state = {
    mode: normalizeMode(config.permissionMode),
    ownerName: normalizeOwner(config.ownerName),
  };

  // 每次组装系统提示都会调用，所以改完之后下一轮就生效。
  const renderText = () => {
    const owner = state.ownerName || '你';
    const body = String(prompt.text || '')
      .replaceAll('{{OWNER}}', owner)
      .trim();
    return body ? `${body}\n\n${MODE_TEXT[state.mode]}`.trim() : '';
  };

  const statusPayload = () => ({
    ok: true,
    version: VERSION,
    enabled,
    mode: state.mode,
    modeLabel: MODE_LABEL[state.mode],
    ownerName: state.ownerName,
    promptFile: prompt.file,
    promptChars: prompt.text.length,
    promptMissing: Boolean(prompt.error),
    sectionName: 'ck-rules:rules',
    order,
    modes: MODES.map((id) => ({ id, label: MODE_LABEL[id] })),
    canSave: Boolean(ctx.get('configEditor') && ctx.fiber && ctx.fiber.entry),
  });

  // ---- 面板接口：读取状态 / 保存设置 ----
  ctx.inject(['webServer'], (host) => {
    host.effect(() => {
      const disposeStatus = host.webServer.register(
        {
          kind: 'exact',
          path: '/ck-rules/status',
          handler: async (request, response) => {
            if (request.method !== 'GET' && request.method !== 'HEAD') {
              response.writeHead(405, { allow: 'GET, HEAD' });
              response.end();
              return;
            }
            sendJson(response, 200, statusPayload());
          },
        },
        'ck-rules status'
      );

      const disposeConfig = host.webServer.register(
        {
          kind: 'exact',
          path: '/ck-rules/config',
          handler: async (request, response) => {
            if (request.method !== 'POST') {
              response.writeHead(405, { allow: 'POST' });
              response.end();
              return;
            }

            let body;
            try {
              body = await readJsonBody(request);
            } catch (error) {
              sendJson(response, 400, {
                ok: false,
                error: `请求内容读不了：${error && error.message ? error.message : error}`,
              });
              return;
            }
            if (!body || typeof body !== 'object' || Array.isArray(body)) {
              sendJson(response, 400, { ok: false, error: '请求内容必须是对象' });
              return;
            }

            const next = { ...state };
            if (body.permissionMode !== undefined) {
              if (!MODE_TEXT[body.permissionMode]) {
                sendJson(response, 400, {
                  ok: false,
                  error: `没有这个档位：${String(body.permissionMode)}`,
                });
                return;
              }
              next.mode = body.permissionMode;
            }
            if (body.ownerName !== undefined) {
              if (typeof body.ownerName !== 'string') {
                sendJson(response, 400, { ok: false, error: '称呼必须是文字' });
                return;
              }
              const owner = normalizeOwner(body.ownerName);
              if ([...owner].length > MAX_OWNER_CHARS) {
                sendJson(response, 400, {
                  ok: false,
                  error: `称呼太长，最多 ${MAX_OWNER_CHARS} 个字`,
                });
                return;
              }
              next.ownerName = owner;
            }

            const editor = ctx.get('configEditor');
            const entry = ctx.fiber && ctx.fiber.entry;
            if (!editor || !entry) {
              sendJson(response, 503, {
                ok: false,
                error: '当前 DSH 环境不支持保存设置（缺少配置服务），只能看不能改。',
              });
              return;
            }

            try {
              await editor.edit(entry, (current) => ({
                ...current,
                permissionMode: next.mode,
                ownerName: next.ownerName,
              }));
            } catch (error) {
              sendJson(response, 500, {
                ok: false,
                error: `保存失败：${error && error.message ? error.message : error}`,
              });
              return;
            }

            state.mode = next.mode;
            state.ownerName = next.ownerName;
            sendJson(response, 200, {
              ok: true,
              mode: state.mode,
              modeLabel: MODE_LABEL[state.mode],
              ownerName: state.ownerName,
            });
          },
        },
        'ck-rules config'
      );

      return () => {
        if (typeof disposeStatus === 'function') disposeStatus();
        if (typeof disposeConfig === 'function') disposeConfig();
      };
    });
  });

  if (!enabled) {
    console.log('[ck-rules] 注入已关闭（enabled=false），面板仍可用');
    return;
  }

  if (prompt.error) {
    console.warn(`[ck-rules] 规矩文件读不到：${prompt.file}（${prompt.error.code || prompt.error.message}）`);
  }

  if (!renderText()) {
    console.warn('[ck-rules] 规矩内容是空的，跳过注入');
    return;
  }

  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: 'ck-rules:rules',
        order,
        text: () => renderText(),
        interpolate: false, // {{OWNER}} 由本插件先替换，剩下的花括号保持原样
      }),
    'ck-rules section'
  );
  console.log(`[ck-rules] 已挂载规矩：${path.basename(prompt.file)} / ${MODE_LABEL[state.mode]} 档`);
}
