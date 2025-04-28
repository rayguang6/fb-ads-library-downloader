// Global variables
const processedAds = new Set();
let currentUser = null;

// Wait for config to be available
function waitForConfig() {
    return new Promise((resolve, reject) => {
        let attempts = 0;
        const maxAttempts = 50;
        const checkConfig = () => {
            try {
                if (window.config) {
                    console.log('Config found:', {
                        url: window.config.SUPABASE_URL ? 'present' : 'missing',
                        key: window.config.SUPABASE_KEY ? 'present' : 'missing',
                        bucket: window.config.STORAGE_BUCKET ? 'present' : 'missing',
                        table: window.config.DATABASE_TABLE ? 'present' : 'missing'
                    });
                    resolve(window.config);
                    return true;
                }
                return false;
            } catch (error) {
                console.error('Error checking config:', error);
                return false;
            }
        };

        // Check immediately first
        if (checkConfig()) return;

        // Then set up interval
        const interval = setInterval(() => {
            attempts++;
            if (checkConfig() || attempts >= maxAttempts) {
                clearInterval(interval);
                if (attempts >= maxAttempts) {
                    const error = new Error('Config not loaded after maximum attempts');
                    console.error(error);
                    reject(error);
                }
            }
        }, 100);
    });
}

// Initialize extension using IIFE
(async () => {
    try {
        console.log('Starting extension initialization...');
        
        // Wait for config to be loaded
        const loadedConfig = await waitForConfig();
        console.log('Configuration loaded successfully');
        
        // Initialize the extension
        await initialize();
        console.log('Extension initialized successfully');
    } catch (error) {
        console.error('Failed to initialize extension:', error);
        console.error('Stack trace:', error.stack);
    }
})();

// Function to get the current user session
async function getCurrentUser() {
    try {
        const result = await chrome.storage.local.get(['userSession', 'sessionTimestamp']);
        console.log('Storage data:', result);
        
        if (result.userSession) {
            console.log('Session details:', {
                email: result.userSession.email,
                id: result.userSession.id,
                hasAccessToken: !!result.userSession.access_token,
                timestamp: result.sessionTimestamp
            });
            return result.userSession;
        }
        console.log('No user session found');
        return null;
    } catch (error) {
        console.error('Error getting user session:', error);
        return null;
    }
}

// Function to check if user is authenticated
async function checkAuthentication() {
  try {
    const user = await getCurrentUser();
    console.log('Authentication check:', {
      hasUser: !!user,
      hasAccessToken: user?.access_token ? 'yes' : 'no',
      tokenLength: user?.access_token?.length,
      userId: user?.id,
      email: user?.email
    });

    if (!user || !user.access_token) {
      console.log('User not authenticated or missing access token');
      return false;
    }

    // Validate token format
    if (typeof user.access_token !== 'string' || user.access_token.length < 10) {
      console.error('Invalid access token format');
      return false;
    }

    currentUser = user;
    console.log('User authenticated:', user.email);
    return true;
  } catch (error) {
    console.error('Error in checkAuthentication:', error);
    return false;
  }
}

// Function to extract data from an ad container
function extractAdData(adContainer) {
  const adData = {
    libraryId: null,
    startedRunningOn: null,
    advertiserProfileImage: null,
    advertiserProfileLink: null,
    advertiserName: null,
    adText: null,
    mediaUrls: [],
    timestamp: new Date().toISOString()
  };

  try {
    // Get Library ID - looking for spans containing "Library ID:"
    const allSpans = adContainer.querySelectorAll('span.x8t9es0');

    // 1. Extract Library ID
    for (const span of allSpans) {
      if (span.textContent.includes('Library ID:')) {
        const match = span.textContent.match(/Library ID:\s*(\d+)/);
        if (match && match[1]) {
          adData.libraryId = match[1];
        }
        break;
      }
    }

    // 2. Extract "Started running on" info (only the date part)
    for (const span of allSpans) {
      if (span.textContent.includes('Started running on')) {
        // Regex to capture only the date portion before any "·" separator.
        const match = span.textContent.match(/Started running on\s+([^·]+)/);
        if (match && match[1]) {
          adData.startedRunningOn = match[1].trim();
        }
        break;
      }
    }

    // 3. Get Advertiser Profile Link and Name
    const advertiserEl = adContainer.querySelector('a.xt0psk2');
    if (advertiserEl) {
      adData.advertiserProfileLink = advertiserEl.href || null;
      adData.advertiserName = advertiserEl.textContent.trim();
    }

    // 4. Get Advertiser Profile Image
    // First, try finding an image inside the advertiser link
    let profileImgEl = adContainer.querySelector('a.xt0psk2 img');
    // If not found, try a fallback selector (e.g., image with class "_8nqq")
    if (!profileImgEl) {
      profileImgEl = adContainer.querySelector('img._8nqq');
    }
    if (profileImgEl && profileImgEl.src) {
      adData.advertiserProfileImage = profileImgEl.src;
    }

    // 5. Get Ad Text (existing logic)
    const adTextEl = adContainer.querySelector('div._7jyr span');
    if (adTextEl && adTextEl.innerText) {
      adData.adText = adTextEl.innerText;
    }

    // First priority: Get video if available
    const videoEl = adContainer.querySelector('video');
    if (videoEl && videoEl.src) {
      adData.mediaUrls.push({
        type: 'video',
        url: videoEl.src
      });
    } 
    // If no video, look for the main ad image
    else {
      // Look for the main ad image in the video display area
      const mainImage = adContainer.querySelector('.x1ywc1zp img, .x14ju556 img');
      if (mainImage && mainImage.src && !mainImage.src.includes('s60x60')) {
        adData.mediaUrls.push({
          type: 'image',
          url: mainImage.src
        });
      }
      // Try to find image in the main content container
      else {
        // Based on the HTML structure, look for the large images (avoiding profile pics)
        const contentImages = adContainer.querySelectorAll('.x1lliihq.x5yr21d.xh8yej3');
        for (const img of contentImages) {
          if (img.src && !img.src.includes('s60x60')) {
            adData.mediaUrls.push({
              type: 'image',
              url: img.src
            });
            break;
          }
        }
      }
      
      // If still no images found, try the more general approach with filtering
      if (adData.mediaUrls.length === 0) {
        const allImages = adContainer.querySelectorAll('img');
        // Sort by width to prioritize larger images
        const sortedImages = Array.from(allImages).sort((a, b) => {
          const widthA = a.width || a.clientWidth || 0;
          const widthB = b.width || b.clientWidth || 0;
          return widthB - widthA; // Descending order
        });
        
        for (const img of sortedImages) {
          // Skip profile pictures and tiny images
          const width = img.width || img.clientWidth || 0;
          if (img.src && width > 150 && !img.src.includes('s60x60') && !img.src.includes('profile_pic')) {
            adData.mediaUrls.push({
              type: 'image',
              url: img.src
            });
            break;
          }
        }
      }
    }

    // Add debugging data for verification
    adData.debug = {
      containerHTML: adContainer.outerHTML.substring(0, 500) + '...' // First 500 chars for debugging
    };

  } catch (e) {
    console.error('Error extracting ad data:', e);
    adData.error = e.message;
  }

  return adData;
}

// Function to generate safe filename
function generateSafeFileName(name) {
  return name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

// Function to upload media to Supabase with improved error handling
async function uploadToSupabase(mediaUrl, options) {
  if (!await checkAuthentication()) {
    throw new Error('User not authenticated');
  }

  const {
    mediaType = 'image',
    libraryId
  } = options;

  try {
    // Get the session token
    const session = await chrome.storage.local.get(['userSession']);
    console.log('Upload session check:', {
      hasSession: !!session.userSession,
      hasAccessToken: !!session.userSession?.access_token,
      userId: session.userSession?.id,
      tokenLength: session.userSession?.access_token?.length
    });

    if (!session.userSession?.access_token) {
      throw new Error('No valid session token found');
    }

    // Fetch the media file
    console.log('Fetching media from URL:', mediaUrl);
    const response = await fetch(mediaUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch media: ${response.status} ${response.statusText}`);
    }
    
    // Get the file as a blob
    const blob = await response.blob();
    console.log('Media blob:', {
      size: blob.size,
      type: blob.type,
      isEmpty: blob.size === 0
    });

    if (blob.size === 0) {
      throw new Error('Retrieved empty blob from media URL');
    }
    
    // Set file extension based on content type
    let fileExt;
    if (blob.type.includes('video')) {
      fileExt = 'mp4';
    } else if (blob.type.includes('image')) {
      fileExt = blob.type.includes('png') ? 'png' : 'jpg';
    } else {
      console.warn('Unexpected media type:', blob.type);
      fileExt = mediaType === 'video' ? 'mp4' : 'jpg';
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const folderPath = `${session.userSession.id}/${libraryId}`;
    const fileName = `${timestamp}.${fileExt}`;
    const fullFileName = `${folderPath}/${fileName}`;
    
    console.log('Upload details:', {
      path: fullFileName,
      contentType: blob.type,
      size: blob.size
    });

    // Create FormData and append file with correct content type
    const formData = new FormData();
    formData.append('file', new File([blob], fileName, { type: blob.type }));
    
    // Construct the upload URL
    const uploadPath = `${config.SUPABASE_URL}/storage/v1/object/${config.STORAGE_BUCKET}/${fullFileName}`;
    
    console.log('Making upload request to:', uploadPath);
    
    // Make the POST request with explicit content type from blob
    const uploadResponse = await fetch(uploadPath, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.userSession.access_token}`,
        'apikey': config.SUPABASE_KEY
      },
      body: formData
    });
    
    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error('Upload response error:', {
        status: uploadResponse.status,
        statusText: uploadResponse.statusText,
        responseText: errorText,
        headers: Object.fromEntries(uploadResponse.headers.entries())
      });
      throw new Error(`Supabase upload failed: ${uploadResponse.status} ${uploadResponse.statusText} - ${errorText}`);
    }
    
    const result = await uploadResponse.json();
    console.log('Upload success:', result);
    
    // Create and verify the public URL
    const publicUrl = `${config.SUPABASE_URL}/storage/v1/object/public/${config.STORAGE_BUCKET}/${fullFileName}`;
    
    // Verify the uploaded file is accessible
    try {
      const verifyResponse = await fetch(publicUrl, { method: 'HEAD' });
      if (!verifyResponse.ok) {
        console.error('Uploaded file verification failed:', {
          status: verifyResponse.status,
          statusText: verifyResponse.statusText
        });
      } else {
        console.log('Uploaded file verified successfully');
      }
    } catch (error) {
      console.error('Error verifying uploaded file:', error);
    }
    
    return { result, publicUrl };
  } catch (error) {
    console.error('Error uploading to Supabase:', error);
    throw error;
  }
}

// Function to save ad data to Supabase database
async function saveToSupabaseDatabase(adData, uploadedFiles = {}) {
  if (!await checkAuthentication()) {
    throw new Error('User not authenticated');
  }

  try {
    // Get the session token
    const session = await chrome.storage.local.get(['userSession']);
    console.log('Database save session check:', {
      hasSession: !!session.userSession,
      hasAccessToken: !!session.userSession?.access_token,
      userId: session.userSession?.id
    });

    if (!session.userSession?.access_token) {
      throw new Error('No valid session token found');
    }

    // Prepare the record for insertion with new schema
    const record = {
      user_id: session.userSession.id,
      library_id: adData.libraryId,
      started_running_on: adData.startedRunningOn,
      profile_image_url: uploadedFiles.profileImage,
      advertiser_profile_link: adData.advertiserProfileLink,
      advertiser_name: adData.advertiserName,
      ad_text: adData.adText,
      media_type: adData.mediaUrls[0]?.type || null,
      media_url: uploadedFiles.adMedia?.[0]?.url || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    console.log('Saving record to database:', {
      libraryId: record.library_id,
      userId: record.user_id,
      advertiserName: record.advertiser_name
    });

    // Make the POST request to insert the record
    const response = await fetch(`${config.SUPABASE_URL}/rest/v1/${config.DATABASE_TABLE}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.userSession.access_token}`,
        'apikey': config.SUPABASE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(record)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Database save error:', {
        status: response.status,
        statusText: response.statusText,
        responseText: errorText
      });
      throw new Error(`Database insertion failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    console.log('Successfully saved ad data to database:', adData.libraryId);
    return true;
  } catch (error) {
    console.error('Error saving to database:', error);
    throw error;
  }
}

// Function to add button to an ad container
function addButtonToContainer(container) {
  // Skip if already has our button
  if (container.querySelector('.my-fb-ad-button')) {
    return;
  }
  
  // Create button
  const button = document.createElement('button');
  button.textContent = 'Download ↓';
  button.className = 'my-fb-ad-button';
  button.style.cssText = `
    background-color: #800080;
    color: white;
    border: none;
    border-radius: 4px;
    padding: 6px 12px;
    font-weight: bold;
    cursor: pointer;
    font-size: 12px;
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 999;
  `;
  
  button.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    
    // Check authentication first
    if (!await checkAuthentication()) {
      // Show login prompt
      button.textContent = 'Please Login';
      button.style.backgroundColor = '#FFA500'; // Orange
      
      // Create a popup message with fixed dismissal
      const loginPrompt = document.createElement('div');
      loginPrompt.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        padding: 20px;
        border-radius: 8px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        z-index: 10000;
        text-align: center;
      `;
      
      const dismissButton = document.createElement('button');
      dismissButton.textContent = 'OK';
      dismissButton.style.cssText = `
        padding: 5px 15px;
        margin-top: 15px;
        cursor: pointer;
        background: #800080;
        color: white;
        border: none;
        border-radius: 4px;
      `;
      
      loginPrompt.innerHTML = `
        <h3 style="margin: 0 0 10px">Login Required</h3>
        <p style="margin: 0 0 15px">Please click the extension icon and login to download ads.</p>
      `;
      loginPrompt.appendChild(dismissButton);
      
      // Ensure proper cleanup on dismiss
      dismissButton.addEventListener('click', () => {
        loginPrompt.remove();
      });
      
      document.body.appendChild(loginPrompt);
      
      // Reset button after delay
      setTimeout(() => {
        button.textContent = 'Download ↓';
        button.style.backgroundColor = '#800080';
      }, 3000);
      return;
    }
    
    // Get ad data from the container
    const adData = extractAdData(container);
    
    // Change button text to indicate processing
    button.textContent = 'Uploading...';
    button.style.backgroundColor = '#FFA500'; // Orange
    
    try {
      const uploadedFiles = {
        profileImage: null,
        adMedia: []
      };

      // Upload profile image if exists
      if (adData.advertiserProfileImage) {
        try {
          const profileUpload = await uploadToSupabase(adData.advertiserProfileImage, {
            mediaType: 'image',
            libraryId: adData.libraryId,
            isProfileImage: true
          });
          uploadedFiles.profileImage = profileUpload.publicUrl;
        } catch (error) {
          console.error('Failed to upload profile image:', error);
        }
      }

      // Upload ad media
      for (const media of adData.mediaUrls) {
        try {
          const mediaUpload = await uploadToSupabase(media.url, {
            mediaType: media.type,
            libraryId: adData.libraryId,
            isProfileImage: false
          });
          uploadedFiles.adMedia.push({
            url: mediaUpload.publicUrl,
            type: media.type
          });
        } catch (error) {
          console.error('Failed to upload ad media:', error);
        }
      }
      
      // Save the ad data to Supabase database
      await saveToSupabaseDatabase(adData, uploadedFiles);
      
      // Visual feedback for success
      button.textContent = 'Uploaded!';
      button.style.backgroundColor = '#4BB543'; // Green
    } catch (error) {
      // Visual feedback on error
      button.textContent = 'Error!';
      button.style.backgroundColor = '#FF0000'; // Red
      console.error('Failed to upload:', error);
    }
    
    // Reset button text and style after a delay
    setTimeout(() => {
      button.textContent = 'Download ↓';
      button.style.backgroundColor = '#800080';
    }, 2000);
  });
  
  // Add the button to the container
  container.style.position = 'relative';
  container.appendChild(button);
}

// Create a unique identifier for an ad container to prevent duplicate processing
function getAdIdentifier(adContainer) {
  // Extract library ID if available
  let libraryId = '';
  const libraryIdEl = adContainer.querySelector('span');
  if (libraryIdEl && libraryIdEl.textContent && libraryIdEl.textContent.includes('Library ID:')) {
    const match = libraryIdEl.textContent.match(/Library ID:\s*(\d+)/);
    if (match && match[1]) {
      libraryId = match[1];
    }
  }
  
  // Get advertiser name if available
  let advertiserName = '';
  const advertiserEl = adContainer.querySelector('a.xt0psk2');
  if (advertiserEl) {
    advertiserName = advertiserEl.textContent.trim();
  }
  
  // Combine with container dimensions for uniqueness
  const rect = adContainer.getBoundingClientRect();
  return `${libraryId}_${advertiserName}_${rect.width}_${rect.height}_${adContainer.offsetTop}`;
}

// Improved function combining your specific class selectors with additional approaches
function findAndProcessAdCards() {
  let newButtonsAdded = 0;
  
  // APPROACH 1: Directly target your specific class combinations
  // First try: parent class x1dr75xp.xh8yej3.x16md763 with child xrvj5dj
  const specificParents = document.querySelectorAll('.x1dr75xp.xh8yej3.x16md763');
  // console.log(`Found ${specificParents.length} specific parent containers`);
  
  for (const parent of specificParents) {
    const childContainers = parent.querySelectorAll('.xrvj5dj');
    
    for (const container of childContainers) {
      // Skip small containers
      if (container.offsetWidth < 100 || container.offsetHeight < 100) continue;
      
      const adId = getAdIdentifier(container);
      
      if (!processedAds.has(adId) && !container.querySelector('.my-fb-ad-button')) {
        processedAds.add(adId);
        addButtonToContainer(container);
        newButtonsAdded++;
        // console.log(`Added button to container via specific classes (approach 1)`);
      }
    }
  }
  
  // APPROACH 2: Try the alternative class selector xrvj5dj.x18m771g
  if (newButtonsAdded === 0) {
    const altContainers = document.querySelectorAll('.xrvj5dj.x18m771g');
    // console.log(`Found ${altContainers.length} containers with alternative classes`);
    
    for (const container of altContainers) {
      // Skip small containers
      if (container.offsetWidth < 100 || container.offsetHeight < 100) continue;
      
      const adId = getAdIdentifier(container);
      
      if (!processedAds.has(adId) && !container.querySelector('.my-fb-ad-button')) {
        processedAds.add(adId);
        addButtonToContainer(container);
        newButtonsAdded++;
        // console.log(`Added button to container via alternative classes (approach 2)`);
      }
    }
  }
  
  // APPROACH 3: General search for containers with xh8yej3 class
  if (newButtonsAdded === 0) {
    const generalContainers = document.querySelectorAll('div.xh8yej3');
    // console.log(`Found ${generalContainers.length} potential containers with xh8yej3 class`);
    
    for (const container of generalContainers) {
      // Skip if it doesn't match size criteria or doesn't have Library ID
      if (container.offsetWidth < 300 || container.offsetHeight < 200) continue;
      if (!container.textContent.includes('Library ID:')) continue;
      
      const adId = getAdIdentifier(container);
      
      if (!processedAds.has(adId) && !container.querySelector('.my-fb-ad-button')) {
        processedAds.add(adId);
        addButtonToContainer(container);
        newButtonsAdded++;
        // console.log(`Added button to container via general class (approach 3)`);
      }
    }
  }
  
  // APPROACH 4: Find by Library ID and walk up to container
  if (newButtonsAdded === 0) {
    // Find all elements with Library ID text
    const libraryIdElements = Array.from(document.querySelectorAll('span')).filter(
      span => span.textContent && span.textContent.includes('Library ID:')
    );
    
    // console.log(`Found ${libraryIdElements.length} Library ID spans`);
    
    for (const idEl of libraryIdElements) {
      const adContainer = findAdCardContainer(idEl);
      
      if (adContainer) {
        const adId = getAdIdentifier(adContainer);
        
        if (!processedAds.has(adId) && !adContainer.querySelector('.my-fb-ad-button')) {
          processedAds.add(adId);
          addButtonToContainer(adContainer);
          newButtonsAdded++;
          // console.log(`Added button to container via Library ID (approach 4)`);
        }
      }
    }
  }
  
  // Log the results
  if (newButtonsAdded > 0) {
    // console.log(`Added ${newButtonsAdded} new download buttons`);
  } else {
    // console.log('No new ad containers found');
  }
  
  return newButtonsAdded;
}

// Helper function to find the ad card container by walking up from a Library ID element
function findAdCardContainer(element) {
  // Walk up to find the container that is likely an ad card
  let current = element;
  let level = 0;
  const maxLevels = 6;  // Don't go up too far
  
  while (current && level < maxLevels) {
    current = current.parentElement;
    level++;
    
    if (!current) break;
    
    // Check for your specific class combinations
    if (current.classList.contains('xrvj5dj') && 
        (current.classList.contains('x18m771g') || 
         (current.parentElement && current.parentElement.classList.contains('x1dr75xp') && 
          current.parentElement.classList.contains('xh8yej3') && 
          current.parentElement.classList.contains('x16md763')))) {
      return current;
    }
    
    // Alternate check for general ad properties
    if (current.offsetWidth > 300 && current.offsetHeight > 250) {
      const text = current.textContent || '';
      if (text.includes('Library ID:') && text.includes('Started running on')) {
        return current;
      }
    }
  }
  
  return null;
}

// Improved mutation observer that uses a more efficient detection strategy
function setupMutationObserver() {
  // Use a debounce mechanism to avoid excessive processing
  let debounceTimer = null;
  
  const observer = new MutationObserver((mutations) => {
    let shouldProcess = false;
    
    // Quick check if any mutations are relevant (avoiding unnecessary processing)
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          // Check if this looks like it could be an ad or container
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check for classes we care about
            if (node.classList && 
                (node.classList.contains('xh8yej3') || 
                 node.classList.contains('xrvj5dj') || 
                 node.classList.contains('x1dr75xp') || 
                 node.classList.contains('x18m771g'))) {
              shouldProcess = true;
              break;
            }
            
            // Check if it's a substantial element that might contain ads
            if (node.tagName === 'DIV' && node.childElementCount > 3) {
              shouldProcess = true;
              break;
            }
          }
        }
        
        if (shouldProcess) break;
      }
    }
    
    if (shouldProcess) {
      // Clear existing timer if there is one
      if (debounceTimer) clearTimeout(debounceTimer);
      
      // Set a new timer
      debounceTimer = setTimeout(() => {
        // console.log('Content change detected, checking for new ads...');
        findAndProcessAdCards();
      }, 300);
    }
  });
  
  // Start observing with appropriate options
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  // console.log('Mutation observer set up');
  return observer;
}

// Improved scroll handler with better debouncing
function setupScrollHandler() {
  let scrollTimer = null;
  let lastScrollPos = window.scrollY;
  let scrollPending = false;
  
  window.addEventListener('scroll', () => {
    // Capture the current scroll position
    const currentPos = window.scrollY;
    
    // If we've scrolled significantly and we haven't processed recently
    if (Math.abs(currentPos - lastScrollPos) > 200 && !scrollPending) {
      lastScrollPos = currentPos;
      scrollPending = true;
      
      // Clear existing timer
      if (scrollTimer) clearTimeout(scrollTimer);
      
      // Set a new timer
      scrollTimer = setTimeout(() => {
        // console.log('Processing after scroll...');
        findAndProcessAdCards();
        scrollPending = false;
      }, 1500);
    }
  });
  
  // console.log('Scroll handler set up');
}

// Update initialize function to be async
async function initialize() {
  console.log('Initializing Facebook Ads Library Downloader...');
  
  try {
    // Check authentication first
    if (!await checkAuthentication()) {
      console.log('Please log in to use the Facebook Ads Library Downloader');
      return;
    }

    // Set up observers and handlers
    setupMutationObserver();
    setupScrollHandler();
    
    // Initial scan for ads
    findAndProcessAdCards();
    
    console.log('Initialization complete');
  } catch (error) {
    console.error('Initialization failed:', error);
  }
}

