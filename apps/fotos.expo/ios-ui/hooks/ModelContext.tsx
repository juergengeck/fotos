import React, { createContext, useContext, ReactNode } from 'react';
import type Model from '../Model';

const ModelContext = createContext<Model | null>(null);

export function ModelProvider({ model, children }: { model: Model; children: ReactNode }) {
  return <ModelContext.Provider value={model}>{children}</ModelContext.Provider>;
}

export function useModel(): Model {
  const model = useContext(ModelContext);
  if (!model) {
    throw new Error('useModel must be used within a ModelProvider');
  }
  return model;
}
