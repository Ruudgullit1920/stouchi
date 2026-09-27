/* Stouchi — what was left in the account when the user joined.
 *
 * ADDITIVE ONLY.
 *
 * - profiles.opening_mil: asked on the home screen right after onboarding
 *   (spec §4.6). Someone who joins mid-period has already spent part of that
 *   salary, so the period onboarding happened in runs on this instead of the
 *   salary's Besoins + Envies. Null until they answer; the app never asks
 *   again once the next payday opens. Stored as that period's Besoins + Envies
 *   budget, so the balance they typed is what Reste shows before bills.
 *   The table-level grants on profiles already cover the new column. */

alter table public.profiles
  add column if not exists opening_mil bigint check (opening_mil between 0 and 1000000000);
