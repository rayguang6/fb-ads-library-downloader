console.log('Popup script starting...');

// Debug logging function
function debugLog(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] ${message}`, data);
}

let supabase = null;

// Initialize Supabase client
function initializeSupabase() {
    try {
        debugLog('INFO', 'Initializing Supabase client');
        if (!window.supabase) {
            throw new Error('Supabase library not loaded');
        }
        if (!window.config) {
            throw new Error('Configuration not loaded');
        }
        
        supabase = window.supabase.createClient(window.config.SUPABASE_URL, window.config.SUPABASE_KEY);
        if (!supabase?.auth) {
            throw new Error('Supabase client initialization failed');
        }
        debugLog('INFO', 'Supabase initialized successfully');
        return true;
    } catch (error) {
        debugLog('ERROR', 'Failed to initialize Supabase', { error: error.message });
        showError('Failed to initialize authentication system. Please refresh and try again.');
        return false;
    }
}

// DOM Elements
const loginView = document.getElementById('loginView');
const loggedInView = document.getElementById('loggedInView');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const userEmailElement = document.getElementById('userEmail');
const statusElement = document.getElementById('status');

// Verify all DOM elements are found
const elements = {
  loginView, loggedInView, emailInput, passwordInput,
  loginBtn, logoutBtn, userEmailElement, statusElement
};

Object.entries(elements).forEach(([name, element]) => {
  if (!element) {
    debugLog('ERROR', `DOM element not found: ${name}`);
    throw new Error(`DOM element not found: ${name}`);
  }
});

// Show status message
function showStatus(message, isError = false) {
    debugLog(isError ? 'ERROR' : 'INFO', 'Status message', { message });
    statusElement.textContent = message;
    statusElement.style.display = 'block';
    statusElement.className = isError ? 'error' : 'success';
    // Keep error messages visible longer
    const timeout = isError ? 10000 : 5000;
    setTimeout(() => {
        statusElement.style.display = 'none';
    }, timeout);
}

// Set loading state
function setLoading(isLoading) {
  loginBtn.disabled = isLoading;
  loginBtn.classList.toggle('loading', isLoading);
  loginBtn.textContent = isLoading ? 'Logging in...' : 'Login';
}

// Store user session
async function storeSession(session) {
  try {
    await chrome.storage.local.set({ 
      'userSession': session,
      'sessionTimestamp': Date.now()
    });
    debugLog('INFO', 'Session stored successfully');
  } catch (error) {
    debugLog('ERROR', 'Failed to store session', { error: error.message });
    throw error;
  }
}

// Retrieve stored session
async function getStoredSession() {
  try {
    const data = await chrome.storage.local.get(['userSession', 'sessionTimestamp']);
    debugLog('INFO', 'Retrieved stored session', { hasSession: !!data.userSession });
    return data;
  } catch (error) {
    debugLog('ERROR', 'Failed to retrieve session', { error: error.message });
    return null;
  }
}

// Clear stored session
async function clearSession() {
  try {
    await chrome.storage.local.remove(['userSession', 'sessionTimestamp']);
    debugLog('INFO', 'Session cleared successfully');
  } catch (error) {
    debugLog('ERROR', 'Failed to clear session', { error: error.message });
  }
}

// Check if session is valid
function isSessionValid(sessionTimestamp) {
  const SESSION_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours
  return Date.now() - sessionTimestamp < SESSION_EXPIRY;
}

// Check if user is already logged in
async function checkAuth() {
  debugLog('INFO', 'Checking authentication status');
  
  if (!supabase?.auth) {
    debugLog('ERROR', 'Supabase client not initialized');
    showStatus('Application not initialized properly', true);
    return;
  }

  try {
    // First check stored session
    const storedData = await getStoredSession();
    debugLog('INFO', 'Stored session data', {
      hasSession: !!storedData?.userSession,
      hasAccessToken: !!storedData?.userSession?.access_token,
      hasTimestamp: !!storedData?.sessionTimestamp
    });

    if (storedData?.userSession && storedData?.sessionTimestamp && isSessionValid(storedData.sessionTimestamp)) {
      debugLog('INFO', 'Found valid stored session');
      
      // Try to refresh the session
      const { data: { session }, error } = await supabase.auth.refreshSession({
        refresh_token: storedData.userSession.refresh_token
      });

      if (error) {
        debugLog('ERROR', 'Failed to refresh session', { error: error.message });
        throw error;
      }

      if (session) {
        // Update stored session with new tokens
        const sessionData = {
          ...storedData.userSession,
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_at: session.expires_at
        };
        await storeSession(sessionData);
        debugLog('INFO', 'Session refreshed and stored', {
          hasNewAccessToken: !!session.access_token,
          expiresAt: session.expires_at
        });
      }

      loginView.style.display = 'none';
      loggedInView.style.display = 'block';
      userEmailElement.textContent = storedData.userSession.email;
      return;
    }

    // If no valid stored session, check Supabase session
    const { data: { user }, error } = await supabase.auth.getUser();
    debugLog('INFO', 'Auth check response', { hasUser: !!user, error });

    if (error) throw error;

    if (user) {
      debugLog('INFO', 'User is logged in', { email: user.email });
      
      // Get the current session
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session) {
        // Store the complete session data
        const sessionData = {
          ...user,
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_at: session.expires_at
        };
        await storeSession(sessionData);
        debugLog('INFO', 'New session stored', {
          hasAccessToken: !!sessionData.access_token,
          expiresAt: sessionData.expires_at
        });
      }

      loginView.style.display = 'none';
      loggedInView.style.display = 'block';
      userEmailElement.textContent = user.email;
    } else {
      debugLog('INFO', 'No user logged in');
      await clearSession();
      loginView.style.display = 'block';
      loggedInView.style.display = 'none';
    }
  } catch (error) {
    debugLog('ERROR', 'Auth check failed', { error: error.message });
    await clearSession();
    showStatus(`Authentication error: ${error.message}`, true);
    loginView.style.display = 'block';
    loggedInView.style.display = 'none';
  }
}

// Login handler function
async function handleLogin() {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    
    debugLog('INFO', 'Login attempt started', { email });
    
    if (!email || !password) {
        showStatus('Please enter both email and password', true);
        return;
    }
    
    if (!supabase?.auth) {
        showStatus('Authentication system not initialized. Please refresh and try again.', true);
        return;
    }
    
    setLoading(true);
    
    try {
        debugLog('INFO', 'Attempting login with Supabase');
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });
        
        debugLog('INFO', 'Login response received', {
            hasError: !!error,
            hasUser: !!data?.user,
            hasSession: !!data?.session
        });
        
        if (error) throw error;
        
        if (!data?.user || !data?.session) {
            throw new Error('Login response missing user or session data');
        }
        
        debugLog('INFO', 'Login successful', { 
            email: data.user.email,
            hasAccessToken: !!data.session.access_token
        });
        
        // Store the complete session data
        const sessionData = {
            ...data.user,
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
            expires_at: data.session.expires_at
        };
        
        await storeSession(sessionData);
        debugLog('INFO', 'Session stored successfully', {
            hasAccessToken: !!sessionData.access_token,
            expiresAt: sessionData.expires_at
        });
        
        showStatus('Login successful!');
        loginView.style.display = 'none';
        loggedInView.style.display = 'block';
        userEmailElement.textContent = data.user.email;
        
    } catch (error) {
        debugLog('ERROR', 'Login failed', { 
            error: error.message,
            stack: error.stack
        });
        let errorMessage = 'Login failed: ';
        if (error.message.includes('Invalid login credentials')) {
            errorMessage += 'Invalid email or password';
        } else if (error.message.includes('Email not confirmed')) {
            errorMessage += 'Please verify your email address';
        } else {
            errorMessage += error.message;
        }
        showStatus(errorMessage, true);
    } finally {
        setLoading(false);
    }
}

// Add event listeners for login with error handling
loginBtn.addEventListener('click', (e) => {
    e.preventDefault();
    handleLogin().catch(error => {
        debugLog('ERROR', 'Unhandled login error', { 
            error: error.message,
            stack: error.stack
        });
        showStatus('Unexpected error during login. Please try again.', true);
    });
});

// Add Enter key support with error handling
emailInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        passwordInput.focus();
    }
});

passwordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        handleLogin().catch(error => {
            debugLog('ERROR', 'Unhandled login error', { 
                error: error.message,
                stack: error.stack
            });
            showStatus('Unexpected error during login. Please try again.', true);
        });
    }
});

// Logout handler
logoutBtn.addEventListener('click', async () => {
    debugLog('INFO', 'Logout initiated');
    try {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        
        await clearSession();
        loginView.style.display = 'block';
        loggedInView.style.display = 'none';
        emailInput.value = '';
        passwordInput.value = '';
        showStatus('Logged out successfully');
    } catch (error) {
        debugLog('ERROR', 'Logout failed', { error: error.message });
        showStatus('Logout failed: ' + error.message, true);
    }
});

// Initialize the popup
async function initializePopup() {
    debugLog('INFO', 'Initializing popup');
    if (!initializeSupabase()) {
        return;
    }
    await checkAuth();
}

// Start initialization
initializePopup(); 