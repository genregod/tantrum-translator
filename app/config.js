/**
 * Where the backend lives.
 *
 * - Local dev on a physical phone: your computer's LAN IP, NOT localhost.
 *   (localhost on the phone means the phone itself.)
 *   Find it with:  ifconfig | grep "inet "   /   ipconfig
 * - Codespaces: forward port 8787, set its visibility to Public, and paste
 *   the resulting https URL here.
 * - Deployed: your public server URL.
 */
export const API_BASE = 'http://192.168.1.100:8787';

export const RECORD_MAX_MS = 30_000; // tantrums are long; recordings needn't be
