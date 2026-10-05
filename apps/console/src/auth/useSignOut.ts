import { useQueryClient } from '@tanstack/react-query';
import { signOut } from './session';

/** Signs out and drops every cached response, so nothing of this session stays in memory. */
export function useSignOut(): () => void {
  const queryClient = useQueryClient();
  return () => {
    // signOut() switches the session status before its first await, so the console unmounts in
    // this render and nothing refetches into the cleared cache: the next operator at this
    // workstation sees none of this session's data.
    void signOut();
    queryClient.clear();
  };
}
