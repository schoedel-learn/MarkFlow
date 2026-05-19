import { inject, Injectable, InjectionToken } from '@angular/core';
import { getApprovedUserEntitlementDoc } from './firebase';

export type EntitlementMode = 'public_byok' | 'approved_server';
export type ApprovedUserLookup = typeof getApprovedUserEntitlementDoc;

export const APPROVED_USER_LOOKUP = new InjectionToken<ApprovedUserLookup>('APPROVED_USER_LOOKUP', {
  providedIn: 'root',
  factory: () => getApprovedUserEntitlementDoc,
});

@Injectable({
  providedIn: 'root'
})
export class EntitlementService {
  private approvedUserLookup = inject(APPROVED_USER_LOOKUP);

  async resolveMode(email: string | null | undefined): Promise<EntitlementMode> {
    const normalizedEmail = email?.trim().toLowerCase();
    if (!normalizedEmail) {
      return 'public_byok';
    }

    const snapshot = await this.approvedUserLookup(normalizedEmail);
    if (!snapshot.exists()) {
      return 'public_byok';
    }

    const data = snapshot.data() as Record<string, unknown> | undefined;
    return data?.['enabled'] === true ? 'approved_server' : 'public_byok';
  }
}