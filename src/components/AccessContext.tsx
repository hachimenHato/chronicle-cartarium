import { createContext, useContext, type ReactNode } from 'react';
import {
  ownerAccount,
  canCreate,
  canChange,
  canExport,
  isAdministrator,
  type UserAccount,
  type ContentModule,
} from '../../shared/access';
const AccessContext = createContext<UserAccount>(ownerAccount());
export const AccessProvider = ({
  actor,
  children,
}: {
  actor: UserAccount;
  children: ReactNode;
}) => <AccessContext.Provider value={actor}>{children}</AccessContext.Provider>;
export function useAccess() {
  const actor = useContext(AccessContext);
  return {
    actor,
    owner: actor.role === 'owner',
    administrator: isAdministrator(actor),
    exportAllowed: canExport(actor),
    create: (module: ContentModule) => canCreate(actor, module),
    update: (module: ContentModule, record: { id: string; createdBy?: string }) =>
      canChange(actor, module, record, 'update'),
    remove: (module: ContentModule, record: { id: string; createdBy?: string }) =>
      canChange(actor, module, record, 'delete'),
  };
}
