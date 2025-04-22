const SUPABASE_URL = 'https://scblfinzevcnuzibkhgt.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjYmxmaW56ZXZjbnV6aWJraGd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDI1NTM1MDcsImV4cCI6MjA1ODEyOTUwN30.tYsF007oi9FgrfQIxvo-quaaH6TbUqDQ_Pb1sVKy4fo';
const STORAGE_BUCKET = 'ads-media';
const DATABASE_TABLE = 'facebook_ads';

// Cache to prevent duplicate processing
const processedAds = new Set();

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

// Function to upload media to Supabase
async function uploadToSupabase(mediaUrl, mediaType, fileName) {
  try {
    // Fetch the media file
    const response = await fetch(mediaUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch media: ${response.status} ${response.statusText}`);
    }
    
    // Get the file as a blob
    const blob = await response.blob();
    
    // Set file extension based on media type
    const fileExt = mediaType === 'video' ? 'mp4' : 'jpg';
    const fullFileName = `${fileName}.${fileExt}`;
    const file = new File([blob], fullFileName, { 
      type: mediaType === 'video' ? 'video/mp4' : 'image/jpeg' 
    });
    
    // Prepare form data for the upload
    const formData = new FormData();
    formData.append('file', file);
    
    // Construct the upload URL (Supabase Storage endpoint)
    const uploadPath = `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${fullFileName}`;
    
    // Make the POST request to upload the file
    const uploadResponse = await fetch(uploadPath, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'apikey': SUPABASE_KEY
      },
      body: formData
    });
    
    if (!uploadResponse.ok) {
      const errorData = await uploadResponse.json();
      throw new Error(`Supabase upload failed: ${errorData.error || uploadResponse.statusText}`);
    }
    
    const result = await uploadResponse.json();
    
    // Create the public URL for the stored file (based on Supabase docs)
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${fullFileName}`;
    
    return { result, publicUrl };
  } catch (error) {
    console.error('Error uploading to Supabase:', error);
    throw error;
  }
}

// Function to save ad data to Supabase database
async function saveToSupabaseDatabase(adData, publicFileUrl = null) {
  try {
    // Prepare a record mapping your adData fields to the database columns.
    // Ensure your Supabase table has matching column names.
    const record = {
      library_id: adData.libraryId || '',
      started_running_on: adData.startedRunningOn || '',
      advertiser_profile_image: adData.advertiserProfileImage || '',
      advertiser_profile_link: adData.advertiserProfileLink || '',
      advertiser_name: adData.advertiserName || '',
      ad_text: adData.adText || '',
      media_type: adData.mediaUrls.length > 0 ? adData.mediaUrls[0].type : '',
      // Use the publicFileUrl from the upload, or if not available, the URL from adData
      media_url: publicFileUrl || (adData.mediaUrls.length > 0 ? adData.mediaUrls[0].url : ''),
      captured_at: adData.timestamp || new Date().toISOString()
    };

    const response = await fetch(`${SUPABASE_URL}/rest/v1/${DATABASE_TABLE}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'apikey': SUPABASE_KEY,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(record)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Database insert error:', errorText);
      throw new Error(`Database insert failed: ${response.status} - ${errorText}`);
    }
    
    const result = await response.json();
    console.log('Database insert successful:', result);
    return result;
  } catch (error) {
    console.error('Error saving to Supabase database:', error);
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
    
    // Get ad data from the container
    const adData = extractAdData(container);
    
    // Change button text to indicate processing
    button.textContent = 'Uploading...';
    button.style.backgroundColor = '#FFA500'; // Orange
    
    try {
      // Generate a filename using advertiser name, library ID, and timestamp
      let fileName = 'fb_ad';
      if (adData.advertiserName) {
        const safeAdvertiserName = adData.advertiserName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        fileName = `${safeAdvertiserName}`;
      }
      if (adData.libraryId) {
        fileName += `_${adData.libraryId}`;
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      fileName += `_${timestamp}`;
      
      // If media exists, upload it
      let publicUrl = null;
      if (adData.mediaUrls.length > 0) {
        const media = adData.mediaUrls[0];
        const uploadResult = await uploadToSupabase(media.url, media.type, fileName);
        publicUrl = uploadResult.publicUrl;
      }
      
      // Save the ad data to Supabase database
      await saveToSupabaseDatabase(adData, publicUrl);
      
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
  console.log(`Found ${specificParents.length} specific parent containers`);
  
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
        console.log(`Added button to container via specific classes (approach 1)`);
      }
    }
  }
  
  // APPROACH 2: Try the alternative class selector xrvj5dj.x18m771g
  if (newButtonsAdded === 0) {
    const altContainers = document.querySelectorAll('.xrvj5dj.x18m771g');
    console.log(`Found ${altContainers.length} containers with alternative classes`);
    
    for (const container of altContainers) {
      // Skip small containers
      if (container.offsetWidth < 100 || container.offsetHeight < 100) continue;
      
      const adId = getAdIdentifier(container);
      
      if (!processedAds.has(adId) && !container.querySelector('.my-fb-ad-button')) {
        processedAds.add(adId);
        addButtonToContainer(container);
        newButtonsAdded++;
        console.log(`Added button to container via alternative classes (approach 2)`);
      }
    }
  }
  
  // APPROACH 3: General search for containers with xh8yej3 class
  if (newButtonsAdded === 0) {
    const generalContainers = document.querySelectorAll('div.xh8yej3');
    console.log(`Found ${generalContainers.length} potential containers with xh8yej3 class`);
    
    for (const container of generalContainers) {
      // Skip if it doesn't match size criteria or doesn't have Library ID
      if (container.offsetWidth < 300 || container.offsetHeight < 200) continue;
      if (!container.textContent.includes('Library ID:')) continue;
      
      const adId = getAdIdentifier(container);
      
      if (!processedAds.has(adId) && !container.querySelector('.my-fb-ad-button')) {
        processedAds.add(adId);
        addButtonToContainer(container);
        newButtonsAdded++;
        console.log(`Added button to container via general class (approach 3)`);
      }
    }
  }
  
  // APPROACH 4: Find by Library ID and walk up to container
  if (newButtonsAdded === 0) {
    // Find all elements with Library ID text
    const libraryIdElements = Array.from(document.querySelectorAll('span')).filter(
      span => span.textContent && span.textContent.includes('Library ID:')
    );
    
    console.log(`Found ${libraryIdElements.length} Library ID spans`);
    
    for (const idEl of libraryIdElements) {
      const adContainer = findAdCardContainer(idEl);
      
      if (adContainer) {
        const adId = getAdIdentifier(adContainer);
        
        if (!processedAds.has(adId) && !adContainer.querySelector('.my-fb-ad-button')) {
          processedAds.add(adId);
          addButtonToContainer(adContainer);
          newButtonsAdded++;
          console.log(`Added button to container via Library ID (approach 4)`);
        }
      }
    }
  }
  
  // Log the results
  if (newButtonsAdded > 0) {
    console.log(`Added ${newButtonsAdded} new download buttons`);
  } else {
    console.log('No new ad containers found');
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
        console.log('Content change detected, checking for new ads...');
        findAndProcessAdCards();
      }, 300);
    }
  });
  
  // Start observing with appropriate options
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  console.log('Mutation observer set up');
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
        console.log('Processing after scroll...');
        findAndProcessAdCards();
        scrollPending = false;
      }, 1500);
    }
  });
  
  console.log('Scroll handler set up');
}

// Initialization function
function initialize() {
  console.log('Facebook Ads Library Scraper initializing...');
  
  // Initial scan after a short delay to allow page to fully load
  setTimeout(() => {
    console.log('Initial scan for ad cards...');
    const count = findAndProcessAdCards();
    console.log(`Initial scan found ${count} ads`);
  }, 1500);
  
  // Set up mutation observer
  const observer = setupMutationObserver();
  
  // Set up scroll handler
  setupScrollHandler();
  
  // Fallback interval checker to catch any missed ads
  // This helps with lazy-loaded content and other edge cases
  setInterval(() => {
    console.log('Periodic scan for ads...');
    findAndProcessAdCards();
  }, 1500);
  
  console.log('Facebook Ads Library Scraper initialized successfully!');
}

// Start the extension
initialize();

