/**
 * @fileoverview Service for fetching and caching TCL vehicle monitoring data.
 * Handles communication with the GrandLyon API and data storage.
 * @module services/vehicleMonitoringService
 */

import axios, { AxiosError } from 'axios';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import {
    CachedVehicleMonitoringData,
    VehicleMonitoringApiResponse,
    VehicleMonitoringDelivery,
} from '../models/vehicleMonitoring.js';
import { sendVehicleMonitoringUpdate } from './vehicleMonitoringStreamService.js';
import { sendEnhancedVehicleMonitoringUpdate } from './vehicleMonitoringEnhancedStreamService.js';

/**
 * Cached vehicle monitoring data storage
 * Stores the latest data fetched from the API
 */
let cachedData: CachedVehicleMonitoringData = {
    payload: null,
    lastUpdated: null,
    count: 0,
};

/**
 * Interval reference for the scheduled data refresh
 */
let refreshInterval: NodeJS.Timeout | null = null;

/**
 * Creates Basic Auth header from email and password
 * @returns Base64 encoded credentials string
 */
const getAuthHeader = (): string => {
    const credentials = `${config.vehicleMonitoring.email}:${config.vehicleMonitoring.password}`;
    return `Basic ${Buffer.from(credentials).toString('base64')}`;
};

/**
 * Extracts total vehicle activity count from the payload
 * @param payload - Raw API payload
 * @returns Total number of vehicle activities
 */
const extractVehicleCount = (payload: VehicleMonitoringApiResponse | null): number => {
    const deliveries = payload?.Siri?.ServiceDelivery?.VehicleMonitoringDelivery;
    if (!Array.isArray(deliveries)) {
        return 0;
    }

    return deliveries.reduce((total: number, delivery: VehicleMonitoringDelivery) => {
        const activities = delivery.VehicleActivity;
        if (!Array.isArray(activities)) {
            return total;
        }
        return total + activities.length;
    }, 0);
};

/**
 * Fetches vehicle monitoring data from the GrandLyon API
 * @returns Promise resolving to the raw vehicle monitoring payload
 * @throws Error if the API request fails
 */
export const fetchVehicleMonitoring = async (): Promise<VehicleMonitoringApiResponse> => {
    logger.debug('🌐 Fetching vehicle monitoring data from GrandLyon API...');

    try {
        const response = await axios.get<VehicleMonitoringApiResponse>(
            config.vehicleMonitoring.baseUrl,
            {
                headers: {
                    Authorization: getAuthHeader(),
                    'Content-Type': 'application/json',
                },
                timeout: 30000, // 30 seconds timeout
            }
        );

        const count = extractVehicleCount(response.data);
        logger.info(`✅ Successfully fetched vehicle monitoring data (${count} vehicles)`);
        return response.data;
    } catch (error) {
        const axiosError = error as AxiosError;
        const errorMessage = axiosError.response
            ? `API responded with status ${axiosError.response.status}`
            : axiosError.message;

        logger.error(`❌ Failed to fetch vehicle monitoring data: ${errorMessage}`, error as Error);
        throw new Error(`Failed to fetch vehicle monitoring data: ${errorMessage}`);
    }
};

/**
 * Updates the cached data with fresh data from the API
 * @returns Promise resolving to the updated cached data
 */
export const updateCachedVehicleMonitoringData = async (): Promise<CachedVehicleMonitoringData> => {
    try {
        const payload = await fetchVehicleMonitoring();
        const now = new Date();
        const count = extractVehicleCount(payload);

        cachedData = {
            payload,
            lastUpdated: now,
            count,
        };

        logger.debug(
            `🔄 Vehicle monitoring cache updated with ${count} vehicles at ${now.toLocaleString('en-US')}`
        );
        sendVehicleMonitoringUpdate(cachedData);
        sendEnhancedVehicleMonitoringUpdate(cachedData);
        return cachedData;
    } catch (error) {
        logger.error('❌ Failed to update vehicle monitoring cached data', error as Error);
        throw error;
    }
};

/**
 * Gets the current cached vehicle monitoring data
 * If cache is empty, fetches fresh data first
 * @returns Promise resolving to the cached vehicle monitoring data
 */
export const getVehicleMonitoringData = async (): Promise<CachedVehicleMonitoringData> => {
    if (cachedData.payload === null || cachedData.lastUpdated === null) {
        logger.info('💾 Vehicle monitoring cache is empty, fetching initial data...');
        await updateCachedVehicleMonitoringData();
    }
    return cachedData;
};

/**
 * Gets the cached vehicle monitoring data without triggering a fetch
 * @returns The current cached data (may be empty)
 */
export const getVehicleMonitoringDataSync = (): CachedVehicleMonitoringData => {
    return cachedData;
};

/**
 * Starts the scheduled data refresh interval
 * Fetches data immediately if cache is empty, then refreshes periodically
 */
export const startVehicleMonitoringRefresh = async (): Promise<void> => {
    logger.info('⏰ Starting vehicle monitoring scheduled refresh...');

    // Fetch immediately if cache is empty
    if (cachedData.payload === null || cachedData.lastUpdated === null) {
        try {
            await updateCachedVehicleMonitoringData();
        } catch (error) {
            logger.warn('⚠️  Initial vehicle monitoring fetch failed, will retry on next interval');
            logger.debug(`Initial fetch error details: ${(error as Error).message}`);
        }
    }

    refreshInterval = setInterval(async () => {
        try {
            await updateCachedVehicleMonitoringData();
        } catch (error) {
            logger.error('❌ Scheduled vehicle monitoring refresh failed', error as Error);
        }
    }, config.vehicleMonitoring.refreshInterval);

    logger.success(
        `⏱️  Vehicle monitoring refresh set for every ${config.vehicleMonitoring.refreshInterval / 1000 / 60} minutes`
    );
};

/**
 * Stops the scheduled vehicle monitoring refresh
 */
export const stopVehicleMonitoringRefresh = (): void => {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
        logger.info('⏹️  Vehicle monitoring refresh stopped');
    }
};
