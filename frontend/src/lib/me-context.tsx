'use client';

import { createContext, useContext } from 'react';
import type { MeResponse } from '@opsflow/shared';

export const MeContext = createContext<MeResponse | null>(null);
export const useMe = () => useContext(MeContext)!;
