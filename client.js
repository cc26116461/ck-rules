window.__ModuleLoader__.load({
  id: 'ck-rules',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect } = React;

    const C = {
      text: 'var(--dsw-alias-text-1, #1f2328)',
      dim: 'var(--dsw-alias-text-3, #6b7280)',
      line: 'var(--dsw-alias-border-1, #e5e7eb)',
      bg: 'var(--dsw-alias-bg-2, #f8f9fa)',
      ok: '#1a7f37',
      off: '#9a6700',
      bad: '#b42318',
    };

    function Row({ label, value, mono }) {
      return h('div', {
        style: { display: 'flex', gap: 10, alignItems: 'baseline', padding: '5px 0', borderBottom: `1px solid ${C.line}` },
      },
        h('span', { style: { color: C.dim, minWidth: 74, flexShrink: 0 } }, label),
        h('span', {
          style: { fontFamily: mono ? 'ui-monospace, Consolas, monospace' : 'inherit', wordBreak: 'break-all', fontSize: mono ? 12 : 13 },
          title: String(value ?? ''),
        }, value === '' || value === undefined ? '—' : String(value))
      );
    }

    function Panel() {
      const [data, setData] = useState(null);
      const [error, setError] = useState('');

      useEffect(() => {
        let alive = true;
        fetch('/ck-rules/status', { cache: 'no-store', credentials: 'same-origin' })
          .then((r) => r.json())
          .then((d) => { if (alive) setData(d); })
          .catch((e) => { if (alive) setError(String(e && e.message ? e.message : e)); });
        return () => { alive = false; };
      }, []);

      const badge = data
        ? h('span', {
          style: {
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 8px', borderRadius: 10,
            fontSize: 12, color: data.enabled ? C.ok : C.off,
            background: data.enabled ? 'rgba(26,127,55,0.1)' : 'rgba(154,103,0,0.12)',
          },
        }, h('span', { style: { width: 6, height: 6, borderRadius: 3, background: data.enabled ? C.ok : C.off } }),
        data.enabled ? '注入中' : '已关闭')
        : null;

      return h('div', { style: { padding: '14px 16px', fontSize: 13, color: C.text, lineHeight: 1.65 } },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 } },
          h('strong', { style: { fontSize: 14 } }, 'CK的规矩'),
          badge
        ),

        error ? h('div', { style: { color: C.bad, fontSize: 12 } }, `读不到状态：${error}`) : null,

        data
          ? h('div', null,
            h(Row, { label: '权限档位', value: `${data.modeLabel}（${data.mode}）` }),
            h(Row, { label: '称呼', value: data.ownerName || '（未设置，用「你」）' }),
            h(Row, { label: '规矩字数', value: `${data.promptChars} 字` }),
            h(Row, { label: '规矩文件', value: data.promptFile, mono: true }),
            h(Row, { label: '段落名', value: data.sectionName, mono: true }),
            data.promptMissing
              ? h('div', { style: { marginTop: 8, color: C.bad, fontSize: 12 } }, '规矩文件读不到，当前没有注入内容。')
              : null
          )
          : h('div', { style: { color: C.dim } }, '正在读取…'),

        h('div', {
          style: { marginTop: 14, padding: 10, background: C.bg, borderRadius: 6, color: C.dim, fontSize: 12, lineHeight: 1.6 },
        },
          '改档位或名字：编辑 ',
          h('code', { style: { fontFamily: 'ui-monospace, Consolas, monospace' } }, 'cordis.patch.yml'),
          ' 里的 config，重启 DSH 生效。'
        )
      );
    }

    return {
      inject: ['slots', 'sidebarRightTabs'],
      apply(ctx) {
        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: 'ck-rules',
          kind: 'ck-rules',
          title: () => 'CK的规矩',
          priority: 'extension',
          guide: [{
            id: 'ck-rules',
            order: 60,
            title: () => 'CK的规矩',
            description: () => '注入状态与权限档位',
          }],
        }), 'ck-rules tab type');

        ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          id: 'ck-rules',
        }, Panel));
      },
    };
  },
});
