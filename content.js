const SUPABASE_URL = 'https://scblfinzevcnuzibkhgt.supabase.co'; // Your Supabase URL
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjYmxmaW56ZXZjbnV6aWJraGd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDI1NTM1MDcsImV4cCI6MjA1ODEyOTUwN30.tYsF007oi9FgrfQIxvo-quaaH6TbUqDQ_Pb1sVKy4fo'; // Replace with your actual Supabase anon key
const STORAGE_BUCKET = 'ads-media'; // Your storage bucket name (adjust if needed)
const DATABASE_TABLE = 'facebook_ads'; // The name of your database table

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

// Find ad containers and add buttons
// function addButtonsToAds() {
//   // Based on the actual HTML, this is the most reliable selector
//   document.querySelectorAll('.x1dr75xp.xh8yej3.x16md763 > .xrvj5dj').forEach(container => {
//     // document.querySelectorAll('[class*="xh8yej3"][class*="x18m771g"]').forEach(container => {


//     // parent:  <div class="x1dr75xp xh8yej3 x16md763">
//     // we target: <div class="xrvj5dj x18m771g x1p5oq8j xbxaen2 x18d9i69 x1u72gb5 xtqikln x1na6gtj x1jr1mh3 xm39877 x7sq92a xxy4fzi">
//     // document.querySelectorAll('[class*="xrvj5dj"][class*="x18m771g"]').forEach(container => {
//     // Skip containers that are too small
//     if (container.offsetWidth < 100 || container.offsetHeight < 100) {
//       return;
//     }
    
//     addButtonToContainer(container);
//   });
// }

function addButtonsToAds() {
  console.log("Looking for ad cards based on Library ID elements...");
  
  // Find elements containing "Library ID:" text, but with more specific targeting
  const libraryIdElements = Array.from(document.querySelectorAll('div[class*="Library ID"], span[class*="Library ID"]'))
    .filter(el => el.textContent && el.textContent.includes('Library ID:'));
  
  if (libraryIdElements.length === 0) {
    // Fallback to a broader search if specific selectors don't work
    const allElements = Array.from(document.querySelectorAll('div, span'))
      .filter(el => el.textContent && el.textContent.includes('Library ID:'));
    
    if (allElements.length > 0) {
      console.log(`Found ${allElements.length} Library ID elements using broader search`);
      processLibraryIdElements(allElements);
    } else {
      console.log("No Library ID elements found");
    }
  } else {
    console.log(`Found ${libraryIdElements.length} Library ID elements using specific selectors`);
    processLibraryIdElements(libraryIdElements);
  }
}

function processLibraryIdElements(elements) {
  elements.forEach((idEl, index) => {
    // Find the ad card container
    let adCard = findAdCardContainer(idEl);
    
    if (adCard) {
      // Only add button if the container doesn't already have one
      if (!adCard.querySelector('.my-fb-ad-button')) {
        addButtonToContainer(adCard);
      }
    }
  });
}

function findAdCardContainer(element) {
  // Walk up to find the container that is likely an ad card
  let current = element;
  let level = 0;
  const maxLevels = 6;  // Don't go up too far
  
  while (current && level < maxLevels) {
    current = current.parentElement;
    level++;
    
    if (!current) break;
    
    // Check if this could be an ad card
    if (current.offsetWidth > 300 && current.offsetHeight > 250) {
      // Must contain certain ad-related text
      const text = current.textContent || '';
      const hasSeeAdDetails = text.includes('See ad details');
      const hasStartedRunning = text.includes('Started running on');
      const hasSponsored = text.includes('Sponsored');
      
      // Must have at least two of these characteristics to be an ad card
      if ((hasSeeAdDetails && hasStartedRunning) || 
          (hasSeeAdDetails && hasSponsored) || 
          (hasStartedRunning && hasSponsored)) {
        
        // Additional check: must contain platform icons or total active time text
        if (text.includes('Total active time') || 
            current.querySelector('img[src*="facebook"]') || 
            current.querySelector('svg[class*="platform"]')) {
          
          return current;
        }
      }
    }
  }
  
  return null;
}


// Set up observer to watch for new ads being loaded
// const observer = new MutationObserver(addButtonsToAds);
// observer.observe(document.body, { childList: true, subtree: true });

// Set up observer to watch for new content
const observer = new MutationObserver((mutations) => {
  let shouldCheck = false;
  
  for (const mutation of mutations) {
    if (mutation.addedNodes.length > 0) {
      // Check if any substantial elements were added
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 1 && (node.tagName === 'DIV' || node.tagName === 'SECTION')) {
          shouldCheck = true;
          break;
        }
      }
      
      if (shouldCheck) break;
    }
  }
  
  if (shouldCheck) {
    // Wait a bit for the content to fully render
    setTimeout(addButtonsToAds, 500);
  }
});

// Start observing with appropriate options
observer.observe(document.body, {
  childList: true,
  subtree: true
});

// Add periodic checker as a backup
setInterval(addButtonsToAds, 3000);

// Initial run to add buttons to existing ads
addButtonsToAds();

// Run when user scrolls to catch any new ads
window.addEventListener('scroll', addButtonsToAds);

// Console log to show the extension is loaded
console.log("Facebook Ads Library Scraper loaded!");