// src/types/express/index.d.ts
import express from 'express';

declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

// Empty export to make this a module
export {};