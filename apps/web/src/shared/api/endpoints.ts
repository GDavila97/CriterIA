import { apiRequest } from './client';
import type {
  AgentsBody,
  CatalogBody,
  CredentialBody,
  EvaluationBody,
  HistoryDeletedBody,
  HistoryItemBody,
  HistorySummaryBody,
  RespuestaHumana,
  RunCreateBody,
  RunCreatedBody,
  SettingsBody,
  SettingsBodyInput,
  UsageBody,
} from './types.gen';

export type ProviderId = CatalogBody['proveedores'][number]['proveedor'];

export const api = {
  createRun: (body: RunCreateBody, signal?: AbortSignal) =>
    apiRequest<RunCreatedBody>('/runs', { method: 'POST', body, signal }),
  approveRun: (runId: string, body: RespuestaHumana) =>
    apiRequest<void>(`/runs/${encodeURIComponent(runId)}/approval`, { method: 'POST', body }),
  catalog: () => apiRequest<CatalogBody>('/catalog'),
  agents: () => apiRequest<AgentsBody>('/agents'),
  usage: () => apiRequest<UsageBody>('/me/usage'),
  settings: () => apiRequest<SettingsBody>('/me/settings'),
  saveSettings: (body: SettingsBodyInput) =>
    apiRequest<SettingsBody>('/me/settings', { method: 'PUT', body }),
  credentials: () => apiRequest<CredentialBody[]>('/me/credentials'),
  saveCredential: (provider: ProviderId, apiKey: string, baseUrl?: string) =>
    apiRequest<CredentialBody>(`/me/credentials/${provider}`, {
      method: 'PUT',
      body: baseUrl ? { api_key: apiKey, base_url: baseUrl } : { api_key: apiKey },
    }),
  deleteCredential: (provider: ProviderId) =>
    apiRequest<void>(`/me/credentials/${provider}`, { method: 'DELETE' }),
  history: () => apiRequest<HistorySummaryBody[]>('/me/runs'),
  historyItem: (runId: string) =>
    apiRequest<HistoryItemBody>(`/me/runs/${encodeURIComponent(runId)}`),
  clearHistory: () => apiRequest<HistoryDeletedBody>('/me/runs', { method: 'DELETE' }),
  evaluation: () => apiRequest<EvaluationBody>('/evaluation', { auth: false }),
};
