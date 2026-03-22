/**
 * @fileoverview Configuration module for the TCL API Mirror application.
 * Loads and exports environment variables and API configuration.
 * @module config
 */

import dotenv from 'dotenv';

dotenv.config();

/**
 * API configuration interface
 */
export interface ApiConfig {
    /** Base URL for the GrandLyon TCL API */
    baseUrl: string;
    /** Email for Basic Auth */
    email: string;
    /** Password for Basic Auth */
    password: string;
    /** Refresh interval in milliseconds */
    refreshInterval: number;
}

/**
 * Traffic API configuration interface
 */
export interface TrafficApiConfig extends ApiConfig {
    /** Base URL for Junior Direct (school lines) traffic alerts */
    juniorDirectBaseUrl: string;
}

/**
 * Server configuration interface
 */
export interface ServerConfig {
    /** Port number for the Express server */
    port: number;
}

/**
 * Application configuration object
 */
export const config = {
    traffic: {
        baseUrl: 'https://data.grandlyon.com/fr/datapusher/ws/rdata/tcl_sytral.tclalertetrafic_2/all.json?start=1&filename=alertes-trafic-reseau-transports-commun-lyonnais-v2',
        juniorDirectBaseUrl:
            'https://data.grandlyon.com/fr/datapusher/ws/rdata/jd_juniordirect.jdalertetrafic_2/all.json?maxfeatures=-1&start=1&filename=alertes-trafic-lignes-scolaires-reseau-transports-commun-lyonnais',
        email: process.env.EMAIL || '',
        password: process.env.PASSWORD || '',
        refreshInterval: parseInt(process.env.TRAFFIC_REFRESH_INTERVAL_MS || '300000', 10), // 5 minutes in milliseconds
    } as TrafficApiConfig,
    vehicleMonitoring: {
        baseUrl: 'https://data.grandlyon.com/siri-lite/2.0/vehicle-monitoring.json',
        email: process.env.EMAIL || '',
        password: process.env.PASSWORD || '',
        refreshInterval: 21 * 1000, // 21 seconds in milliseconds
    } as ApiConfig,
    server: {
        port: parseInt(process.env.PORT || '3000', 10),
    } as ServerConfig,
};
