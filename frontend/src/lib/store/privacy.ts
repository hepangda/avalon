import { create } from 'zustand';

/** Account privacy; signed-out visitors have nothing to hide. */
export const usePrivacyStore = create<{ hideRecord: boolean }>(() => ({ hideRecord: false }));
