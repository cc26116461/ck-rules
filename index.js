// CK的规矩 —— 把对话规矩注入系统提示，并提供执行权限档位与状态面板。
// 只用官方 systemPrompt.section() 与 webServer 路由，不改宿主文件、不打补丁。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ORDER = 450; // 紧跟 persona 之后、计划模式策略之前

export const inject = ['systemPrompt'];

const MODE_TEXT = {
  loose: '执行权限：宽松。只读操作直接做；写文件、改配置、跑命令也直接做，做完再说明。',
  standard:
    '执行权限：标准。只读操作直接做；写文件、改配置、删除、跑有副作用的命令之前，先用一句话说明要做什么、动哪里，等确认再动。',
  strict:
    '执行权限：严格。每一步都先说明并等确认，读文件、写文件、跑命令都一样；不要连续自动执行多个步骤。',
};

const MODE_LABEL = { loose: '宽松', standard: '标准', strict: '严格' };

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

export function apply(ctx, config = {}) {
  const enabled = config.enabled !== false;
  const mode = normalizeMode(config.permissionMode);
  const order = Number.isFinite(config.order) ? Number(config.order) : DEFAULT_ORDER;

  // ---- 状态接口：给右侧栏面板读 ----
  ctx.inject(['webServer'], (host) => {
    host.effect(() => {
      const dispose = host.webServer.register(
        {
          kind: 'exact',
          path: '/ck-rules/status',
          handler: async (request, response) => {
            if (request.method !== 'GET') {
              response.writeHead(405, { allow: 'GET' });
              response.end();
              return;
            }
            const prompt = readPrompt(config);
            const body = JSON.stringify({
              ok: true,
              version: '0.2.0',
              enabled,
              mode,
              modeLabel: MODE_LABEL[mode],
              ownerName: String(config.ownerName || ''),
              promptFile: prompt.file,
              promptChars: prompt.text.length,
              promptMissing: Boolean(prompt.error),
              sectionName: 'ck-rules:rules',
              order,
            });
            response.writeHead(200, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            });
            response.end(body);
          },
        },
        'ck-rules status'
      );
      return () => {
        if (typeof dispose === 'function') dispose();
      };
    });
  });

  if (!enabled) {
    console.log('[ck-rules] 注入已关闭（enabled=false），面板仍可用');
    return;
  }

  const { text, file, error } = readPrompt(config);
  if (error) {
    console.warn(`[ck-rules] 规矩文件读不到：${file}（${error.code || error.message}）`);
  }

  const owner = String(config.ownerName || '').trim();
  let body = owner ? text.replaceAll('{{OWNER}}', owner) : text.replaceAll('{{OWNER}}', '你');
  body = `${body.trim()}\n\n${MODE_TEXT[mode]}`.trim();
  if (!body) {
    console.warn('[ck-rules] 规矩内容是空的，跳过注入');
    return;
  }

  ctx.effect(
    () => ctx.systemPrompt.section({ name: 'ck-rules:rules', order, text: body }),
    'ck-rules section'
  );
  console.log(`[ck-rules] 已挂载规矩：${path.basename(file)} / ${mode} 档`);
}
