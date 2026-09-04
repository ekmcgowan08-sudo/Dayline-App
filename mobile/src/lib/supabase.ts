import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupportedStorage } from '@supabase/supabase-js';
import { ENV } from '../constants/config';

/**
 * AsyncStorage backs the Supabase session (refresh token + access token).
 * This matches the recovered baseline's choice and is Supabase's own
 * documented approach for Expo/React Native (see
 * supabase.com/docs/guides/getting-started/quickstarts/expo-react-native).
 * It is unencrypted-at-rest on the device, same tradeoff most RN apps make.
 */
const asyncStorageAdapter: SupportedStorage = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};

export const supabase = createClient(ENV.supabaseUrl, ENV.supabaseAnonKey, {
  auth: {
    storage: asyncStorageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
