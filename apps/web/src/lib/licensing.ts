/**
 * Licensing constants.
 *
 * Sightrail is AGPL-3.0-or-later. For a service that other people interact with
 * over a network, section 13 of the license requires offering those users the
 * *Corresponding Source* of the version being run — so the UI links to the source
 * rather than only naming the license. `Sidebar` and the Help page both use these
 * values; `THIRD-PARTY-NOTICES.md` has the full picture.
 *
 * A fork that is deployed for others should set `VITE_SOURCE_URL` to its own
 * repository at build time. Pointing at the upstream project would offer the
 * wrong source, which is exactly what §13 forbids.
 */
export const SOURCE_URL: string =
  import.meta.env.VITE_SOURCE_URL ?? 'https://github.com/hcdangan/sightrail';

/** SPDX identifier, matching every manifest in the repository. */
export const LICENSE_ID = 'AGPL-3.0-or-later';

/** Human-readable name, for prose. */
export const LICENSE_NAME = 'GNU Affero General Public License v3.0 or later';

export const LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';

/** Repository path of the notices file, as listed in the Help page. */
export const THIRD_PARTY_NOTICES_PATH = 'THIRD-PARTY-NOTICES.md';
