const FIXED_PROVIDERS = [
  { slug: 'openai', name: 'OpenAI' },
  { slug: 'anthropic', name: 'Anthropic' },
  { slug: 'deepseek', name: 'DeepSeek' },
  { slug: 'google', name: 'Google' },
  { slug: 'kimi', name: '月之暗面' },
  { slug: 'qwen', name: '阿里通义' },
  { slug: 'doubao', name: '字节豆包' },
  { slug: 'hunyuan', name: '腾讯混元' }
];

function getDynamicProviders(dataset) {
  const models = Array.isArray(dataset?.models) ? dataset.models : [];
  const map = new Map();

  for (const p of FIXED_PROVIDERS) {
    map.set(p.slug, p);
  }

  for (const m of models) {
    if (!m || !m.provider) continue;
    const providerName = String(m.provider).trim();
    if (!providerName) continue;

    const existing = Array.from(map.values()).find(
      p => p.name.toLowerCase() === providerName.toLowerCase() || p.slug.toLowerCase() === providerName.toLowerCase()
    );

    if (!existing) {
      const slug = providerName.toLowerCase().replace(/\s+/g, '-');
      map.set(slug, { slug, name: providerName });
    }
  }

  return Array.from(map.values());
}

module.exports = {
  FIXED_PROVIDERS,
  getDynamicProviders
};

