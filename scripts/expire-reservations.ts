import { expireTemporaryReservationsInPostgres, usesPostgresDatabase } from '../server/database';

if (!usesPostgresDatabase()) throw new Error('Esta rotina exige Supabase/Postgres.');
const expiredReservations = await expireTemporaryReservationsInPostgres();
console.log(JSON.stringify({ success: true, expiredReservations }));
