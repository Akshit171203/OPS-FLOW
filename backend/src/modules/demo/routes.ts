import { Router } from 'express';
import { contextFrom } from '../../lib/context';
import { requireRole } from '../../middleware/auth';
import { simulatePaymentIncident } from './simulate';

export const demoRouter = Router();

demoRouter.post('/simulate-incident', ...requireRole('ADMIN'), async (req, res) => {
  res.status(201).json(await simulatePaymentIncident(contextFrom(req)));
});
