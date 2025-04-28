// Minified Supabase JavaScript client
(function(global) {
  console.log('Initializing Supabase client library');
  
  let currentSession = null;
  
  function createClient(url, key, options) {
    console.log('Creating Supabase client for URL:', url);
    
    return {
      auth: {
        signInWithPassword: async function({ email, password }) {
          console.log('Attempting login for:', email);
          try {
            const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'apikey': key
              },
              body: JSON.stringify({ email, password })
            });
            
            if (!response.ok) {
              const error = await response.json();
              throw new Error(error.error_description || error.msg);
            }
            
            const data = await response.json();
            return {
              data: {
                session: {
                  access_token: data.access_token,
                  refresh_token: data.refresh_token,
                  expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString()
                },
                user: {
                  id: data.user.id,
                  email: data.user.email
                }
              }
            };
          } catch (error) {
            return { error };
          }
        },
        
        getUser: async function() {
          console.log('Getting user data');
          try {
            const session = await this.getSession();
            if (session.error || !session.data?.session?.access_token) {
              return { data: { user: null } };
            }
            
            const response = await fetch(`${url}/auth/v1/user`, {
              headers: {
                'Authorization': `Bearer ${session.data.session.access_token}`,
                'apikey': key
              }
            });
            
            if (!response.ok) {
              throw new Error('Failed to get user');
            }
            
            const user = await response.json();
            return { data: { user } };
          } catch (error) {
            return { error };
          }
        },
        
        getSession: async function() {
          console.log('Getting current session');
          try {
            // Try to get session from storage
            const stored = await chrome.storage.local.get(['userSession']);
            if (stored.userSession?.access_token) {
              return {
                data: {
                  session: {
                    access_token: stored.userSession.access_token,
                    refresh_token: stored.userSession.refresh_token,
                    expires_at: stored.userSession.expires_at
                  }
                }
              };
            }
            return { data: { session: null } };
          } catch (error) {
            return { error };
          }
        },
        
        refreshSession: async function({ refresh_token }) {
          console.log('Refreshing session');
          try {
            const response = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'apikey': key
              },
              body: JSON.stringify({ refresh_token })
            });
            
            if (!response.ok) {
              throw new Error('Failed to refresh session');
            }
            
            const data = await response.json();
            return {
              data: {
                session: {
                  access_token: data.access_token,
                  refresh_token: data.refresh_token,
                  expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString()
                }
              }
            };
          } catch (error) {
            return { error };
          }
        },
        
        signOut: async function() {
          console.log('Signing out');
          try {
            const session = await this.getSession();
            if (session.data?.session?.access_token) {
              await fetch(`${url}/auth/v1/logout`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${session.data.session.access_token}`,
                  'apikey': key
                }
              });
            }
            await chrome.storage.local.remove(['userSession', 'sessionTimestamp']);
            return { error: null };
          } catch (error) {
            return { error };
          }
        }
      }
    };
  }

  // Export to global scope
  if (typeof window !== 'undefined') {
    console.log('Setting up global supabase object');
    window.supabase = { createClient };
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this); 