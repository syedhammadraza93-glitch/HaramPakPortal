import { eq, sql } from "drizzle-orm";
import type { Tx } from "../database/connection";
import { packageDepartures } from "../database/schema";
import { conflict, notFound } from "../utils/http";

/**
 * Seat inventory per departure. Every change locks the departure row (SELECT … FOR UPDATE) inside the caller's
 * transaction, so two agents can never both take the last seat.
 */
async function lockDeparture(tx: Tx, departureId: string) {
  const [dep] = await tx.select().from(packageDepartures).where(eq(packageDepartures.id, departureId)).for("update");
  if (!dep) throw notFound("Departure not found");
  return dep;
}

export const seatsLeftOf = (d: { capacity: number | null; seatsHeld: number; seatsSold: number }) =>
  d.capacity === null ? null : Math.max(0, d.capacity - d.seatsHeld - d.seatsSold);

/** Holds seats for a submitted booking. Throws 409 when not enough seats are left. */
export async function holdSeats(tx: Tx, departureId: string, seats: number, today: string): Promise<void> {
  if (seats <= 0) return;
  const dep = await lockDeparture(tx, departureId);
  if (dep.status !== "open") throw conflict("This departure is closed for booking.");
  if (dep.departureDate < today) throw conflict("This departure date has passed.");
  if (dep.bookingDeadline && dep.bookingDeadline < today) throw conflict("The booking deadline for this departure has passed.");
  const left = seatsLeftOf(dep);
  if (left !== null && left < seats) {
    throw conflict(left === 0 ? "Sorry, this departure is now sold out." : `Only ${left} seat${left === 1 ? "" : "s"} left on this departure.`);
  }
  await tx.update(packageDepartures).set({ seatsHeld: sql`${packageDepartures.seatsHeld} + ${seats}` }).where(eq(packageDepartures.id, departureId));
}

export async function releaseHeldSeats(tx: Tx, departureId: string, seats: number): Promise<void> {
  if (seats <= 0) return;
  await lockDeparture(tx, departureId);
  await tx.update(packageDepartures).set({ seatsHeld: sql`greatest(${packageDepartures.seatsHeld} - ${seats}, 0)` }).where(eq(packageDepartures.id, departureId));
}

/** On confirmation: held seats become sold. Extra seats (more passengers than held) need free capacity. */
export async function confirmSeats(tx: Tx, departureId: string, held: number, total: number): Promise<void> {
  const dep = await lockDeparture(tx, departureId);
  const extra = total - held;
  if (extra > 0) {
    const left = seatsLeftOf(dep);
    if (left !== null && left < extra) throw conflict(`Only ${left} more seat${left === 1 ? "" : "s"} available on this departure.`);
  }
  await tx
    .update(packageDepartures)
    .set({ seatsHeld: sql`greatest(${packageDepartures.seatsHeld} - ${held}, 0)`, seatsSold: sql`${packageDepartures.seatsSold} + ${total}` })
    .where(eq(packageDepartures.id, departureId));
}

export async function releaseSoldSeats(tx: Tx, departureId: string, seats: number): Promise<void> {
  if (seats <= 0) return;
  await lockDeparture(tx, departureId);
  await tx.update(packageDepartures).set({ seatsSold: sql`greatest(${packageDepartures.seatsSold} - ${seats}, 0)` }).where(eq(packageDepartures.id, departureId));
}
