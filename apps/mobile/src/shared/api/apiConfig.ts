import Constants from 'expo-constants';

/**
 * Адрес API. Явно задаётся через EXPO_PUBLIC_API_URL; иначе берётся хост,
 * с которого запущен Expo dev server (работает в одной сети), и порт API 3000.
 */
function resolveApiUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  const devServerHost = Constants.expoConfig?.hostUri?.split(':')[0];
  return `http://${devServerHost ?? 'localhost'}:3000`;
}

export const API_URL = resolveApiUrl();
