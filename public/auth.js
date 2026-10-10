// Browser-side Supabase auth client using direct API calls
const SUPABASE_URL = 'https://gqmzekycqvfxyblhjoqb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdxbXpla3ljcXZmeHlibGhqb3FiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2MzEzMjMsImV4cCI6MjA5MzIwNzMyM30.VYqxM3mWtF2iBP-tLeRZsUdKvmp3gvmsMyrH0wEAds0';

// Define the auth helpers immediately so pages and shared-scripts.js can use them
// as soon as this script runs (consumers still wait on authReady if needed).
(() => {
  // Store the session in localStorage so it survives a full-page redirect (e.g.
  // returning from Square checkout) and is shared across tabs. Migrate any session
  // left in the old sessionStorage location on first load.
  window.setSession = function(session) {
    if (session) {
      localStorage.setItem('supabase_session', JSON.stringify(session));
    } else {
      localStorage.removeItem('supabase_session');
    }
    try { sessionStorage.removeItem('supabase_session'); } catch (_) {}
  };

  window.getSession = function() {
    try {
      let session = localStorage.getItem('supabase_session');
      if (!session) {
        // One-time migration from the previous per-tab storage.
        session = sessionStorage.getItem('supabase_session');
        if (session) {
          localStorage.setItem('supabase_session', session);
          try { sessionStorage.removeItem('supabase_session'); } catch (_) {}
        }
      }
      return session ? JSON.parse(session) : null;
    } catch (_) {
      // Blocked storage or a corrupted value — behave as signed out.
      return null;
    }
  };

  // Supabase access tokens expire (1 hour by default). Without exchanging the
  // refresh token for a new one, a signed-in visitor was silently logged out.
  function tokenExpiryMs(session) {
    if (Number(session.expires_at)) return Number(session.expires_at) * 1000;
    try {
      const payload = session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(payload)).exp * 1000;
    } catch (_) {
      return 0;
    }
  }

  let refreshing = null;

  // Resolves to a session whose access token is valid for at least another minute
  // (refreshing it first when needed), or null when signed out. Concurrent callers
  // share one refresh request.
  window.ensureFreshSession = function() {
    const session = window.getSession();
    if (!session || !session.access_token) return Promise.resolve(null);
    if (tokenExpiryMs(session) - Date.now() > 60000) return Promise.resolve(session);
    if (!session.refresh_token) {
      window.setSession(null);
      return Promise.resolve(null);
    }
    if (!refreshing) {
      refreshing = fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
        body: JSON.stringify({ refresh_token: session.refresh_token })
      })
        .then(async (response) => {
          const data = await response.json().catch(() => ({}));
          if (response.ok && data.access_token) {
            window.setSession(data);
            return data;
          }
          // Only a definitive rejection signs the visitor out; any other failure
          // keeps the session so a later attempt can retry.
          if (response.status === 400 || response.status === 401) {
            window.setSession(null);
            return null;
          }
          return session;
        })
        .catch(() => session)
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  };

  window.signUp = async function(email, password) {
    try {
      // Server creates a pre-confirmed account (no verification email) and the
      // user_profiles row, using the service-role Admin API.
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        return { error: { message: (data && data.message) || 'Sign up failed' } };
      }

      // Account is active immediately — sign in to establish a session.
      return await window.signIn(email, password);
    } catch (error) {
      return { error: { message: error.message } };
    }
  };

  window.signIn = async function(email, password) {
    try {
      const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          email,
          password
        })
      });

      const data = await response.json().catch(() => ({}));

      // The token endpoint returns the session fields at the top level. Treat any
      // non-OK status or a missing access_token as a failure (GoTrue reports bad
      // credentials via msg/error_code, not an `error` field).
      if (!response.ok || !data.access_token) {
        const message = data.error_description || data.msg || data.error_code || data.error || 'Invalid email or password.';
        return { error: { message } };
      }

      window.setSession(data);
      return { data: { session: data, user: data.user }, error: null };
    } catch (error) {
      return { error: { message: error.message } };
    }
  };

  window.signOut = async function() {
    try {
      const session = window.getSession();
      if (!session) {
        return { error: null };
      }
      
      const response = await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${session.access_token}`
        }
      });
      
      window.setSession(null);
      return { error: null };
    } catch (error) {
      window.setSession(null);
      return { error: null };
    }
  };

  window.getCurrentUser = async function() {
    try {
      const session = await window.ensureFreshSession();
      if (!session) {
        return null;
      }
      // A fresh token already carries its user — skip the network round trip.
      // (The API re-validates the token on every privileged request anyway.)
      if (session.user && session.user.id) {
        return session.user;
      }
      
      const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        method: 'GET',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${session.access_token}`
        }
      });
      
      const data = await response.json();
      if (data.error || data.id === undefined) {
        window.setSession(null);
        return null;
      }
      
      return data;
    } catch (error) {
      return null;
    }
  };

  window.onAuthStateChange = async function(callback) {
    // Call immediately with current session
    const currentSession = window.getSession();
    callback('INITIAL_SESSION', currentSession);
    
    // Set up periodic checking for session changes
    const checkInterval = setInterval(async () => {
      const user = await window.getCurrentUser();
      const newSession = user ? window.getSession() : null;
      
      if (!user && currentSession) {
        callback('SIGNED_OUT', null);
      }
    }, 60000); // Check every minute
    
    // Return unsubscribe function
    return {
      unsubscribe: () => clearInterval(checkInterval)
    };
  };

  // Keep the token fresh on long-lived pages (no network unless it is expiring).
  setInterval(() => { window.ensureFreshSession(); }, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') window.ensureFreshSession();
  });

  // Signal that auth is ready once any expired token has been refreshed, so the
  // first API calls on the page carry a valid token.
  window.ensureFreshSession().finally(() => {
    window.authReady = true;
    window.dispatchEvent(new Event('authReady'));
  });
})();
