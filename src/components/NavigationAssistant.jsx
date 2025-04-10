"use client"

import { useEffect, useRef, useState } from "react"
import { io } from "socket.io-client"

const NavigationAssistant = () => {
  const [isActive, setIsActive] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [lastMessage, setLastMessage] = useState("")
  const [error, setError] = useState(null)
  const [isMobile, setIsMobile] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const [isAndroid, setIsAndroid] = useState(false)
  const [cameraPermissionRequested, setCameraPermissionRequested] = useState(false)
  const [apiStatus, setApiStatus] = useState("Checking...")

  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const socketRef = useRef(null)
  const isCapturingRef = useRef(false)
  const utteranceRef = useRef(null)

  // API endpoint configuration
  const API_ENDPOINT = "https://see-for-me-api-production.up.railway.app"

  // Check API status on component mount
  useEffect(() => {
    const checkApiStatus = async () => {
      try {
        console.log("Checking API status at:", API_ENDPOINT)

        // First try a simple fetch to test connectivity
        const response = await fetch(`${API_ENDPOINT}/socket.io/?EIO=4&transport=polling`, {
          method: "GET",
          mode: "cors",
          cache: "no-cache",
        })

        if (response.ok || response.status === 200) {
          console.log("API connectivity test successful")
          setApiStatus("Online")
          setError(null)
        } else {
          console.error("API connectivity test failed with status:", response.status)
          setApiStatus("Error")
          setError("API is not responding correctly. Some features may not work.")
        }
      } catch (err) {
        console.error("API connectivity test failed with error:", err)
        setApiStatus("Offline")
        setError("Cannot connect to the API server. Please check your internet connection.")
      }
    }

    checkApiStatus()
  }, [])

  // Socket.IO connection - connect to backend API
  useEffect(() => {
    if (!isActive) return

    // Disconnect any existing socket
    if (socketRef.current) {
      socketRef.current.disconnect()
    }

    try {
      console.log(`Connecting to API at: ${API_ENDPOINT}`)

      // Create socket with explicit options for better compatibility
      const socket = io(API_ENDPOINT, {
        reconnectionAttempts: 5,
        timeout: 10000,
        transports: ["websocket", "polling"],
        upgrade: true,
        forceNew: true,
        secure: true,
        rejectUnauthorized: false,
        withCredentials: false,
      })

      socketRef.current = socket

      socket.on("connect", () => {
        console.log("Socket.IO connected successfully to API!")
        setIsConnected(true)
        setError(null)
      })

      socket.on("disconnect", () => {
        console.log("Socket.IO disconnected from API")
        setIsConnected(false)
      })

      socket.on("connect_error", (err) => {
        console.error("Socket.IO connection error:", err)
        setError(`Connection error: Cannot connect to API server. Please check your internet connection.`)
        setIsConnected(false)
      })

      socket.on("server_response", (data) => {
        console.log("Received API response:", data)
        const message = data.message || "No guidance available"
        setLastMessage(message)
        speakMessage(message)
      })

      // Set a timeout for connection
      const connectionTimeout = setTimeout(() => {
        if (socket.connected) return
        console.error("Socket.IO connection timeout")
        setError(
          `Connection timeout: Could not connect to API server within 10 seconds. Please check your internet connection.`,
        )
      }, 10000)

      return () => {
        clearTimeout(connectionTimeout)
        socket.disconnect()
        socketRef.current = null
      }
    } catch (err) {
      console.error("Error creating Socket.IO connection:", err)
      setError(`Connection error: ${err.message}. Please check your internet connection.`)
      return () => {}
    }
  }, [isActive])

  // Detect device type
  useEffect(() => {
    const detectDevice = () => {
      const userAgent = navigator.userAgent || window.opera

      // Check for iOS devices
      const isIOSDevice =
        /iphone|ipad|ipod/i.test(userAgent.toLowerCase()) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)

      // Check for Android devices
      const isAndroidDevice = /android/i.test(userAgent.toLowerCase())

      // More comprehensive mobile detection
      const isMobileDevice =
        isIOSDevice ||
        isAndroidDevice ||
        /webos|blackberry|iemobile|opera mini/i.test(userAgent.toLowerCase()) ||
        (window.innerWidth <= 768 && "ontouchstart" in window) ||
        navigator.maxTouchPoints > 1

      setIsMobile(isMobileDevice)
      setIsIOS(isIOSDevice)
      setIsAndroid(isAndroidDevice)

      console.log(
        "Device detected as:",
        isIOSDevice
          ? "iOS mobile"
          : isAndroidDevice
            ? "Android mobile"
            : isMobileDevice
              ? "Other mobile"
              : "desktop/laptop",
        "- Touch points:",
        navigator.maxTouchPoints,
        "- Screen width:",
        window.innerWidth,
      )
    }

    detectDevice()

    // Also detect on resize in case of orientation changes
    window.addEventListener("resize", detectDevice)

    return () => {
      window.removeEventListener("resize", detectDevice)
    }
  }, [])

  // Capture frame function
  async function captureFrame(videoElement) {
    return new Promise((resolve) => {
      const canvas = document.createElement("canvas")
      const ctx = canvas.getContext("2d")
      canvas.width = videoElement.videoWidth
      canvas.height = videoElement.videoHeight

      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height)

      canvas.toBlob(
        (blob) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve(reader.result)
          reader.readAsArrayBuffer(blob)
        },
        "image/webp",
        0.8,
      ) // Use 80% quality for better performance
    })
  }

  // Capture and send five frames
  async function captureAndSendFiveFrames(videoElement) {
    try {
      if (isSpeaking) {
        console.log("Not capturing frames because speech is in progress")
        return
      }

      isCapturingRef.current = true
      console.log("Starting to capture frames")

      const frames = []
      for (let i = 0; i < 5; i++) {
        const frame = await captureFrame(videoElement)
        frames.push(frame)
        await new Promise((res) => setTimeout(res, 300))
      }

      console.log("Sending batch of", frames.length, "frames to API")
      if (socketRef.current && socketRef.current.connected) {
        socketRef.current.emit("send_frames_batch", { frames: frames })
      } else {
        console.error("Socket not connected, can't send frames")
      }
    } catch (err) {
      console.error("Error capturing frames:", err)
      setError("Error capturing frames from camera")
    } finally {
      isCapturingRef.current = false
    }
  }

  // Replace the initCamera function with this improved version that better handles device-specific camera selection
  const initCamera = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Camera access is not supported by this browser")
      }

      setCameraPermissionRequested(true)

      // Different camera initialization based on device type
      if (isMobile) {
        console.log("Mobile device detected - requesting back camera")

        try {
          // First try with exact environment (back camera) constraint
          console.log("Attempting to access back camera with exact constraint")
          const backCameraStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: { exact: "environment" },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          })

          if (videoRef.current) {
            videoRef.current.srcObject = backCameraStream
            streamRef.current = backCameraStream
            setError(null)
            console.log("Back camera initialized successfully with exact constraint")

            try {
              await videoRef.current.play()
            } catch (playErr) {
              console.error("Error playing back camera video:", playErr)
            }
          }
          return // Exit early if successful
        } catch (exactConstraintErr) {
          // This error is expected on devices without a back camera
          console.log("Could not access back camera with exact constraint, trying preferred constraint")

          try {
            // Try with preferred environment (back camera) constraint
            const preferredBackCameraStream = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: {
                facingMode: "environment", // Prefer back camera but don't require it
                width: { ideal: 1280 },
                height: { ideal: 720 },
              },
            })

            if (videoRef.current) {
              videoRef.current.srcObject = preferredBackCameraStream
              streamRef.current = preferredBackCameraStream
              setError(null)
              console.log("Camera initialized with preferred back camera constraint")

              try {
                await videoRef.current.play()
              } catch (playErr) {
                console.error("Error playing camera video:", playErr)
              }
            }
            return // Exit early if successful
          } catch (preferredConstraintErr) {
            console.log("Could not access camera with preferred constraint, trying basic access")
          }
        }
      } else {
        // For laptops/desktops, directly use the front camera (typically the only camera)
        console.log("Laptop/Desktop detected - requesting front camera")

        try {
          const frontCameraStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: "user", // Front camera for laptops
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          })

          if (videoRef.current) {
            videoRef.current.srcObject = frontCameraStream
            streamRef.current = frontCameraStream
            setError(null)
            console.log("Front camera initialized successfully")

            try {
              await videoRef.current.play()
            } catch (playErr) {
              console.error("Error playing front camera video:", playErr)
            }
          }
          return // Exit early if successful
        } catch (frontCameraErr) {
          console.log("Could not access front camera with specific constraint, trying basic access")
        }
      }

      // Last resort: try with any camera (fallback for all devices)
      console.log("Trying basic camera access as last resort")
      const basicStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: true,
      })

      if (videoRef.current) {
        videoRef.current.srcObject = basicStream
        streamRef.current = basicStream
        setError(null)
        console.log("Basic camera access successful")

        try {
          await videoRef.current.play()
        } catch (playErr) {
          console.error("Error playing video with basic camera access:", playErr)
        }
      }
    } catch (err) {
      console.error("Camera initialization error:", err)

      let errorMessage = "Camera access error"

      // Device-specific error handling
      if (isAndroid) {
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          errorMessage =
            "Camera access denied. On Android Chrome, please tap the lock icon in the address bar, select 'Site settings', and enable camera access."
        } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
          errorMessage = "Camera is in use by another app. Please close any apps using the camera and try again."
        } else {
          errorMessage = "Android camera error. Please check your camera permissions in Chrome settings."
        }
      } else if (isIOS) {
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          errorMessage = "Camera access denied. On iOS, go to Settings > Safari > Camera and ensure it's allowed."
        } else {
          errorMessage = "iOS camera error. Please check your camera permissions in Safari settings."
        }
      } else if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        errorMessage = "Camera access denied. Please enable camera permissions in your browser settings."
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        errorMessage = "No camera found on this device."
      } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
        errorMessage = "Camera is already in use by another application."
      } else if (err.name === "NotSupportedError") {
        errorMessage = "Camera access is not supported by this browser."
      }

      setError(errorMessage)
      setIsActive(false)
    }
  }

  // Try to enumerate available devices to help with debugging
  const listAvailableDevices = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        console.log("enumerateDevices() not supported in this browser")
        return
      }

      const devices = await navigator.mediaDevices.enumerateDevices()
      const videoDevices = devices.filter((device) => device.kind === "videoinput")

      console.log("Available video devices:", videoDevices.length)
      videoDevices.forEach((device, index) => {
        console.log(`Video device ${index + 1}:`, device.label || `Camera ${index + 1}`)
      })
    } catch (err) {
      console.error("Error listing devices:", err)
    }
  }

  const startCaptureCycle = () => {
    if (!isActive || !isConnected || isSpeaking || isCapturingRef.current) {
      console.log("Not starting capture cycle:", {
        isActive,
        isConnected,
        isSpeaking,
        isCapturing: isCapturingRef.current,
      })
      return
    }

    const video = videoRef.current

    if (!video) {
      console.error("Video element not found")
      return
    }

    if (video.readyState < 2) {
      console.log("Video not ready, waiting...")
      setTimeout(startCaptureCycle, 100)
      return
    }

    console.log("Starting capture cycle")
    captureAndSendFiveFrames(video)
  }

  // Replace the current speakMessage function with this improved version
  const speakMessage = (message) => {
    if (!message || isSpeaking) return

    if (!window.speechSynthesis) {
      console.error("Speech synthesis not supported")
      setError("Text-to-speech is not supported by this browser")
      return
    }

    // Cancel any ongoing speech
    window.speechSynthesis.cancel()

    setIsSpeaking(true)
    console.log("Starting to speak:", message)

    // Create a new utterance
    const utterance = new SpeechSynthesisUtterance(message)
    utteranceRef.current = utterance

    // Set properties for better speech on mobile
    utterance.rate = isIOS ? 1.1 : 1.0 // Slightly faster on iOS
    utterance.pitch = 1.0
    utterance.volume = 1.0 // Maximum volume

    // Try to select a clear voice if available
    const voices = window.speechSynthesis.getVoices()
    console.log("Available voices:", voices.length)

    // Select the best voice for the platform
    let selectedVoice = null

    // For iOS, try to find a specific voice that works well
    if (isIOS) {
      selectedVoice = voices.find(
        (voice) =>
          voice.name.includes("Samantha") ||
          voice.name.includes("Karen") ||
          (voice.lang === "en-US" && voice.localService === true),
      )
    }
    // For Android, prefer Google voices
    else if (isAndroid) {
      selectedVoice = voices.find(
        (voice) =>
          (voice.name.includes("Google") && voice.lang.includes("en")) || voice.name.includes("English United States"),
      )
    }

    // Fallback to any English voice
    if (!selectedVoice) {
      selectedVoice = voices.find(
        (voice) => voice.lang.includes("en-US") || voice.lang.includes("en-GB") || voice.lang.includes("en"),
      )
    }

    if (selectedVoice) {
      console.log("Selected voice:", selectedVoice.name)
      utterance.voice = selectedVoice
    } else if (voices.length > 0) {
      // Just use the first available voice if no English voice is found
      console.log("Using default voice:", voices[0].name)
      utterance.voice = voices[0]
    }

    // Handle speech completion
    utterance.onend = () => {
      console.log("Speech completed")
      setIsSpeaking(false)
      // Wait a short delay before starting next capture cycle
      setTimeout(() => {
        console.log("Starting next capture cycle after speech")
        startCaptureCycle()
      }, 500)
    }

    utterance.onerror = (event) => {
      console.error("Speech synthesis error:", event)
      setIsSpeaking(false)
      setTimeout(startCaptureCycle, 500)
    }

    // For iOS, we need to use a workaround to make speech work reliably
    if (isIOS) {
      // iOS requires speech to be triggered within a user interaction
      // and sometimes needs a "kick" to start properly
      speechSynthesis.speak(utterance)

      // This pause and resume trick helps on iOS
      setTimeout(() => {
        speechSynthesis.pause()
        speechSynthesis.resume()
      }, 100)
    } else {
      // Normal speech for other platforms
      speechSynthesis.speak(utterance)
    }

    // Set a timeout to prevent hanging if speech doesn't complete
    const timeoutDuration = Math.max(5000, message.length * 100)
    setTimeout(() => {
      if (isSpeaking && utteranceRef.current === utterance) {
        console.warn("Speech timeout reached, forcing next cycle")
        setIsSpeaking(false)
        startCaptureCycle()
      }
    }, timeoutDuration)
  }

  // Add this function to force reload the page - useful for mobile troubleshooting
  const forceReload = () => {
    window.location.reload()
  }

  // Add these helper functions after the speakMessage function
  const selectVoice = (utterance, voices) => {
    // First try to find a good English voice
    let selectedVoice = null

    // For iOS, try to find a specific voice that works well
    if (isIOS) {
      selectedVoice = voices.find(
        (voice) =>
          voice.name.includes("Samantha") ||
          voice.name.includes("Karen") ||
          (voice.lang === "en-US" && voice.localService === true),
      )
    }
    // For Android, prefer Google voices
    else if (isAndroid) {
      selectedVoice = voices.find(
        (voice) =>
          (voice.name.includes("Google") && voice.lang.includes("en")) || voice.name.includes("English United States"),
      )
    }

    // Fallback to any English voice
    if (!selectedVoice) {
      selectedVoice = voices.find(
        (voice) => voice.lang.includes("en-US") || voice.lang.includes("en-GB") || voice.lang.includes("en"),
      )
    }

    if (selectedVoice) {
      console.log("Selected voice:", selectedVoice.name)
      utterance.voice = selectedVoice
    } else if (voices.length > 0) {
      // Just use the first available voice if no English voice is found
      console.log("Using default voice:", voices[0].name)
      utterance.voice = voices[0]
    }
  }

  const continueSpeech = (utterance, message) => {
    // Set properties for better speech on mobile
    utterance.rate = isIOS ? 1.1 : 1.0 // Slightly faster on iOS
    utterance.pitch = 1.0
    utterance.volume = 1.0 // Maximum volume

    // Handle speech completion
    utterance.onend = () => {
      console.log("Speech completed")
      setIsSpeaking(false)
      // Wait a short delay before starting next capture cycle
      setTimeout(() => {
        console.log("Starting next capture cycle after speech")
        startCaptureCycle()
      }, 500)
    }

    utterance.onerror = (event) => {
      console.error("Speech synthesis error:", event)
      setIsSpeaking(false)
      setTimeout(startCaptureCycle, 500)
    }

    // For iOS, we need to use a workaround to make speech work reliably
    if (isIOS) {
      // iOS requires speech to be triggered within a user interaction
      // and sometimes needs a "kick" to start properly
      speechSynthesis.speak(utterance)

      // This pause and resume trick helps on iOS
      setTimeout(() => {
        speechSynthesis.pause()
        speechSynthesis.resume()
      }, 100)
    } else {
      // Normal speech for other platforms
      speechSynthesis.speak(utterance)
    }

    // Set a timeout to prevent hanging if speech doesn't complete
    const timeoutDuration = Math.max(5000, message.length * 100)
    setTimeout(() => {
      if (isSpeaking && utteranceRef.current === utterance) {
        console.warn("Speech timeout reached, forcing next cycle")
        setIsSpeaking(false)
        startCaptureCycle()
      }
    }, timeoutDuration)
  }

  // Add this function to manually trigger audio context initialization
  // (helps with mobile audio restrictions)
  const initAudio = () => {
    try {
      // Create a short audio context to "unlock" audio on iOS/Android
      const AudioContext = window.AudioContext || window.webkitAudioContext
      if (AudioContext) {
        const audioCtx = new AudioContext()

        // Create a short silent sound
        const oscillator = audioCtx.createOscillator()
        const gainNode = audioCtx.createGain()
        gainNode.gain.value = 0 // silent
        oscillator.connect(gainNode)
        gainNode.connect(audioCtx.destination)

        // Play for a very short time
        oscillator.start(audioCtx.currentTime)
        oscillator.stop(audioCtx.currentTime + 0.001)

        console.log("Audio context initialized")
      }
    } catch (e) {
      console.error("Could not initialize audio context:", e)
    }
  }

  // Modify the toggleActive function to include audio initialization
  const toggleActive = () => {
    const newState = !isActive
    setIsActive(newState)

    if (newState) {
      // Initialize audio context to help with mobile audio restrictions
      initAudio()

      // Check API status before proceeding
      const checkApiStatus = async () => {
        try {
          console.log("Checking API status at:", API_ENDPOINT)

          // First try a simple fetch to test connectivity
          const response = await fetch(`${API_ENDPOINT}/socket.io/?EIO=4&transport=polling`, {
            method: "GET",
            mode: "cors",
            cache: "no-cache",
          })

          if (response.ok || response.status === 200) {
            console.log("API connectivity test successful")
            setApiStatus("Online")
            setError(null)
          } else {
            console.error("API connectivity test failed with status:", response.status)
            setApiStatus("Error")
            setError("API is not responding correctly. Some features may not work.")
          }
        } catch (err) {
          console.error("API connectivity test failed with error:", err)
          setApiStatus("Offline")
          setError("Cannot connect to the API server. Please check your internet connection.")
        }
      }
      checkApiStatus().then(() => {
        // List available devices for debugging
        listAvailableDevices().then(() => {
          initCamera()
        })
      })
    } else {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
        streamRef.current = null
      }

      if (window.speechSynthesis) {
        window.speechSynthesis.cancel()
      }

      setIsSpeaking(false)
    }
  }

  // Start capture cycle when active and connected
  useEffect(() => {
    if (isActive && isConnected && !isSpeaking && !isCapturingRef.current) {
      console.log("Initial capture cycle starting")
      startCaptureCycle()
    }
  }, [isActive, isConnected, isSpeaking])

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }
      if (socketRef.current) {
        socketRef.current.disconnect()
      }
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel()
      }
    }
  }, [])

  // Handle video click for manual camera start
  const handleVideoClick = () => {
    if (!videoRef.current) return

    console.log("Manual video restart attempted")

    if (isIOS || isAndroid) {
      // For mobile, we might need to completely reinitialize
      if (!streamRef.current && isActive) {
        console.log("Attempting to reinitialize camera on tap")
        initCamera()
        return
      }

      // Try to play the video
      videoRef.current.play().catch((e) => {
        console.error("Error playing video after manual restart:", e)

        // If play fails and we're active, try reinitializing
        if (isActive) {
          console.log("Play failed, attempting to reinitialize camera")

          // Stop any existing tracks
          if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => track.stop())
            streamRef.current = null
          }

          // Clear the video source
          videoRef.current.srcObject = null

          // Try to initialize again
          setTimeout(initCamera, 100)
        }
      })
    } else {
      // For non-mobile, just try to play
      videoRef.current.play().catch((e) => {
        console.error("Error playing video after manual restart:", e)
      })
    }
  }

  // Add a useEffect to load voices as soon as possible
  // Add this after your other useEffects
  useEffect(() => {
    // Load voices as early as possible
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices()
      console.log("Pre-loaded voices:", voices.length)

      // On iOS, we need to "warm up" the speech synthesis
      if (isIOS && voices.length > 0) {
        try {
          // Create a silent utterance to initialize the speech system
          const warmupUtterance = new SpeechSynthesisUtterance("")
          warmupUtterance.volume = 0 // Silent
          warmupUtterance.rate = 1
          speechSynthesis.speak(warmupUtterance)
          console.log("Warmed up speech synthesis on iOS")
        } catch (e) {
          console.error("Error warming up speech:", e)
        }
      }
    }

    // Initialize speech synthesis
    if (window.speechSynthesis) {
      loadVoices()

      if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = loadVoices
      }

      // For iOS, we need to periodically "ping" the speech synthesis
      // to prevent it from going to sleep
      let speechKeepAliveInterval

      if (isIOS) {
        speechKeepAliveInterval = setInterval(() => {
          if (!isSpeaking) {
            speechSynthesis.cancel() // This helps keep the system active
          }
        }, 5000)
      }

      return () => {
        if (speechSynthesis.onvoiceschanged !== undefined) {
          speechSynthesis.onvoiceschanged = null
        }

        if (speechKeepAliveInterval) {
          clearInterval(speechKeepAliveInterval)
        }
      }
    }
  }, [isIOS, isSpeaking])

  return (
    <div className="flex flex-col gap-6 max-w-3xl mx-auto">
      {error && (
        <div className="flex flex-col gap-2 p-3 rounded-md bg-red-100 text-red-700">
          <div className="flex items-center gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="flex-shrink-0"
            >
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <span className="font-medium">Error</span>
          </div>
          <p>{error}</p>

          {error.includes("Connection error") && (
            <div className="mt-2 text-sm">
              <p className="font-medium">Connection Troubleshooting:</p>
              <ol className="list-decimal pl-5 mt-1 space-y-1">
                <li>Make sure you have an active internet connection</li>
                <li>Check if the API server is online</li>
                <li>Try reloading the page</li>
                <li>If the problem persists, the API server might be down</li>
              </ol>
            </div>
          )}

          {isAndroid && error.includes("Camera") && (
            <div className="mt-2 text-sm">
              <p className="font-medium">Android Chrome Troubleshooting:</p>
              <ol className="list-decimal pl-5 mt-1 space-y-1">
                <li>Tap the lock/info icon in the address bar</li>
                <li>Select "Site settings"</li>
                <li>Set Camera permission to "Allow"</li>
                <li>Reload the page</li>
                <li>If that doesn't work, try clearing Chrome's cache and data</li>
              </ol>
            </div>
          )}

          {isIOS && error.includes("Camera") && (
            <div className="mt-2 text-sm">
              <p className="font-medium">iOS Safari Troubleshooting:</p>
              <ol className="list-decimal pl-5 mt-1 space-y-1">
                <li>Close all Safari tabs and restart Safari</li>
                <li>Go to Settings → Safari → Camera → Allow</li>
                <li>Go to Settings → Privacy & Security → Camera → Enable for Safari</li>
                <li>Try using Chrome for iOS instead</li>
              </ol>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" checked={isActive} onChange={toggleActive} />
              <div className="w-14 h-8 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-6 peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-emerald-500"></div>
            </label>
            <span className="text-lg font-medium">{isActive ? "Active" : "Inactive"}</span>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={isConnected ? "text-emerald-500" : "text-red-500"}
              >
                {isConnected ? (
                  <>
                    <path d="M3 18v-6a9 9 0 0 1 18 0v6"></path>
                    <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path>
                  </>
                ) : (
                  <>
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                    <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path>
                    <path d="M5 12.55a10.94 10.94 0 0 0-3.17-2.39"></path>
                    <path d="M10.71 5.05A16 16 0 0 0 1.42 9"></path>
                    <path d="M22.58 9a15.91 15.91 0 0 0-4.7-2.88"></path>
                    <path d="M8.53 16.11a6 6 0 0 0 6.95 0"></path>
                    <line x1="12" y1="20" x2="12.01" y2="20"></line>
                  </>
                )}
              </svg>
              <span>{isConnected ? "Connected" : "Disconnected"}</span>
            </div>

            <div className="flex items-center gap-2 text-sm">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={apiStatus === "Online" ? "text-emerald-500" : "text-red-500"}
              >
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                <line x1="8" y1="21" x2="16" y2="21"></line>
                <line x1="12" y1="17" x2="12" y2="21"></line>
              </svg>
              <span>API: {apiStatus}</span>
            </div>
          </div>
        </div>
        <div
          className="relative aspect-video bg-black rounded-lg overflow-hidden"
          onClick={handleVideoClick} // Add click handler for mobile
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover ${isActive ? "opacity-100" : "opacity-50"}`}
          />

          {!isActive && (
            <div className="absolute inset-0 flex items-center justify-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="64"
                height="64"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-white opacity-50"
              >
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                <circle cx="12" cy="13" r="4"></circle>
              </svg>
            </div>
          )}

          {isSpeaking && (
            <div className="absolute bottom-2 right-2 bg-black/50 text-white px-2 py-1 rounded-full flex items-center space-x-1">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="animate-pulse"
              >
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                <line x1="12" y1="19" x2="12" y2="23"></line>
                <line x1="8" y1="23" x2="16" y2="23"></line>
              </svg>
              <span className="text-xs">Speaking...</span>
            </div>
          )}

          {isCapturingRef.current && (
            <div className="absolute bottom-2 left-2 bg-black/50 text-white px-2 py-1 rounded-full flex items-center space-x-1">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="animate-pulse"
              >
                <circle cx="12" cy="12" r="10"></circle>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
              <span className="text-xs">Capturing...</span>
            </div>
          )}

          {(isIOS || isAndroid) && isActive && (
            <div className="absolute top-2 left-0 right-0 text-center">
              <span className="bg-black/70 text-white text-sm px-3 py-1 rounded-full">Tap here to start camera</span>
            </div>
          )}
        </div>
        <button
          className={`w-full py-4 text-lg font-medium rounded-md text-white transition-colors ${
            isActive ? "bg-red-500 hover:bg-red-600" : "bg-emerald-500 hover:bg-emerald-600"
          }`}
          onClick={toggleActive}
        >
          {isActive ? "Stop Navigation Assistant" : "Start Navigation Assistant"}
        </button>
        <button
          className="w-full py-2 mt-2 text-sm font-medium rounded-md text-white bg-blue-500 hover:bg-blue-600"
          onClick={() => {
            initAudio()
            speakMessage("This is a test of the speech system. If you can hear this, speech is working correctly.")
          }}
        >
          Test Speech
        </button>
        <button
          className="w-full py-2 mt-2 text-sm font-medium rounded-md text-white bg-purple-500 hover:bg-purple-600"
          onClick={forceReload}
        >
          Reload Application
        </button>
        // Add a device info section to the status display to help with debugging
        <div className="p-4 bg-slate-100 rounded-lg">
          <h3 className="font-medium mb-1">Status:</h3>
          <p className="mb-2">
            {isSpeaking
              ? "Speaking guidance..."
              : isCapturingRef.current
                ? "Capturing frames..."
                : isConnected
                  ? "Ready to capture"
                  : "Waiting for connection"}
          </p>
          <p className="mb-2 text-sm text-gray-500">
            Device: {isIOS ? "iOS" : isAndroid ? "Android" : isMobile ? "Mobile" : "Laptop/Desktop"}
            {isAndroid && " • Using back camera on Android"}
            {isIOS && " • Using back camera on iOS"}
            {!isMobile && " • Using front camera"}
            {cameraPermissionRequested && !error && " • Camera permission granted"}
          </p>
          <p className="text-sm text-gray-500 mb-2">
            API: {apiStatus} • {isConnected ? "Connected" : "Disconnected"}
          </p>
          {lastMessage && (
            <>
              <h3 className="font-medium mb-1">Last Guidance:</h3>
              <p>{lastMessage}</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default NavigationAssistant
