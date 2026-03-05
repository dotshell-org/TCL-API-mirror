/**
 * @fileoverview Express application configuration and middleware setup.
 * @module app
 */

import express, { Request, Response, NextFunction } from 'express';
import trafficRoutes from './routes/trafficRoutes.js';
import vehicleMonitoringRoutes from './routes/vehicleMonitoringRoutes.js';

const app = express();

// Middleware
app.use((req: Request, res: Response, next: NextFunction) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
    }
    next();
});
app.use(express.json());

/**
 * Health check endpoint
 * @route GET /health
 */
app.get('/health', (req: Request, res: Response) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
    });
});

/**
 * API routes
 * All traffic-related endpoints are prefixed with /traffic
 */
app.use('/traffic', trafficRoutes);

/**
 * Vehicle monitoring routes
 * All vehicle monitoring endpoints are prefixed with /vehicle-monitoring
 */
app.use('/vehicle-monitoring', vehicleMonitoringRoutes);

/**
 * 404 handler for undefined routes
 */
app.use((req: Request, res: Response) => {
    res.status(404).json({
        success: false,
        error: 'Route not found',
        timestamp: new Date().toISOString(),
    });
});

export default app;
