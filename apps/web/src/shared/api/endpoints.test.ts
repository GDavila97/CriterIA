import { apiRequest } from './client';
import { api } from './endpoints';

vi.mock('./client', () => ({ apiRequest: vi.fn(async () => ({})) }));

describe('api endpoints', () => {
  it('map each call to its method, path and body', async () => {
    await api.createRun({ requerimiento: 'x' });
    await api.approveRun('a/b', { decision: 'aprobado' });
    await api.catalog();
    await api.agents();
    await api.usage();
    await api.settings();
    await api.saveSettings({ save_history: true });
    await api.credentials();
    await api.saveCredential('openai', 'sk');
    await api.saveCredential('openai_compatible', 'sk', 'https://x.test/v1');
    await api.deleteCredential('groq');
    await api.history();
    await api.historyItem('r 1');
    await api.clearHistory();
    await api.evaluation();

    expect(vi.mocked(apiRequest).mock.calls).toEqual([
      ['/runs', { method: 'POST', body: { requerimiento: 'x' } }],
      ['/runs/a%2Fb/approval', { method: 'POST', body: { decision: 'aprobado' } }],
      ['/catalog'],
      ['/agents'],
      ['/me/usage'],
      ['/me/settings'],
      ['/me/settings', { method: 'PUT', body: { save_history: true } }],
      ['/me/credentials'],
      ['/me/credentials/openai', { method: 'PUT', body: { api_key: 'sk' } }],
      [
        '/me/credentials/openai_compatible',
        { method: 'PUT', body: { api_key: 'sk', base_url: 'https://x.test/v1' } },
      ],
      ['/me/credentials/groq', { method: 'DELETE' }],
      ['/me/runs'],
      ['/me/runs/r%201'],
      ['/me/runs', { method: 'DELETE' }],
      ['/evaluation', { auth: false }],
    ]);
  });
});
