/**
 * @fileoverview TypeScript interfaces for TCL vehicle monitoring data.
 * Defines the structure of data returned by the GrandLyon SIRI-lite API.
 * @module models/vehicleMonitoring
 */

/**
 * Vehicle location information
 */
export interface VehicleLocation {
    Latitude: number;
    Longitude: number;
    [key: string]: unknown;
}

/**
 * Line reference
 */
export interface LineRef {
    value: string;
    [key: string]: unknown;
}

/**
 * Vehicle reference
 */
export interface VehicleRef {
    value: string;
    [key: string]: unknown;
}

/**
 * Vehicle monitoring reference
 */
export interface VehicleMonitoringRef {
    value: string;
    [key: string]: unknown;
}

/**
 * Monitored vehicle journey information
 */
export interface MonitoredVehicleJourney {
    LineRef: LineRef;
    VehicleLocation: VehicleLocation;
    VehicleRef?: VehicleRef;
    [key: string]: unknown;
}

/**
 * Vehicle activity information
 */
export interface VehicleActivity {
    MonitoredVehicleJourney: MonitoredVehicleJourney;
    VehicleMonitoringRef: VehicleMonitoringRef;
    RecordedAtTime?: string;
    [key: string]: unknown;
}

/**
 * Vehicle monitoring delivery payload
 */
export interface VehicleMonitoringDelivery {
    /** Array of vehicle activities */
    VehicleActivity?: VehicleActivity[];
    /** Additional fields */
    [key: string]: unknown;
}

/**
 * SIRI-lite vehicle monitoring response shape (partial)
 */
export interface VehicleMonitoringApiResponse {
    Siri?: {
        ServiceDelivery?: {
            VehicleMonitoringDelivery?: VehicleMonitoringDelivery[];
            [key: string]: unknown;
        };
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

/**
 * Cached data structure with metadata
 */
export interface CachedVehicleMonitoringData {
    /** Raw API payload */
    payload: VehicleMonitoringApiResponse | null;
    /** Timestamp of last update */
    lastUpdated: Date | null;
    /** Total number of vehicle activities */
    count: number;
}
