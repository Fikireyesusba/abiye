/** Age in whole years from a date of birth (YYYY-MM-DD), on the given day (default: today). */
export function ageFrom(dob: string | null | undefined, today = new Date()): number | null {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const [y, m, d] = dob.split("-").map(Number);
  let age = today.getUTCFullYear() - y;
  if (today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d)) age--;
  return age >= 0 ? age : null;
}

/** "Female · 29 years" style summary for admin pages (English). */
export function personSummary(sex: string | null | undefined, dob: string | null | undefined): string {
  const age = ageFrom(dob);
  return [sex === "female" ? "Female" : sex === "male" ? "Male" : null, age !== null ? `${age} years` : null].filter(Boolean).join(" · ");
}

/** Latest allowed date of birth for a given minimum age (YYYY-MM-DD), for <input type="date" max>. */
export function maxBirthDate(minAge: number, today = new Date()): string {
  return new Date(Date.UTC(today.getUTCFullYear() - minAge, today.getUTCMonth(), today.getUTCDate())).toISOString().slice(0, 10);
}
