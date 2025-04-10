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
  const [connectionAttempts, setConnectionAttempts] = useState(0)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [speechStatus, setSpeechStatus] = useState("Not tested")

  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const socketRef = useRef(null)
  const isCapturingRef = useRef(false)
  const utteranceRef = useRef(null)
  const reconnectTimeoutRef = useRef(null)

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

  // Socket.IO connection - connect to backend API with improved stability for mobile
  useEffect(() => {
    if (!isActive) return

    // Clear any existing reconnection timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    // Disconnect any existing socket
    if (socketRef.current) {
      socketRef.current.disconnect()
      socketRef.current = null
    }

    const connectSocket = () => {
      try {
        setIsReconnecting(true)
        console.log(`Connecting to API at: ${API_ENDPOINT} (Attempt ${connectionAttempts + 1})`)

        // Create socket with optimized options for mobile stability
        const socket = io(API_ENDPOINT, {
          reconnectionAttempts: 10,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
          timeout: 20000,
          transports: ["websocket", "polling"],
          upgrade: true,
          forceNew: true,
          secure: true,
          rejectUnauthorized: false,
          withCredentials: false,
          autoConnect: true,
          perMessageDeflate: true,
          pingTimeout: 30000,
          pingInterval: 25000,
        })

        socketRef.current = socket

        socket.on("connect", () => {
          console.log("Socket.IO connected successfully to API!")
          setIsConnected(true)
          setIsReconnecting(false)
          setConnectionAttempts(0)
          setError(null)
        })

        socket.on("disconnect", (reason) => {
          console.log("Socket.IO disconnected from API. Reason:", reason)
          setIsConnected(false)

          // Don't attempt to reconnect if we're not active anymore
          if (!isActive) return

          // If it's a server disconnect or transport close, try to reconnect
          if (reason === "io server disconnect" || reason === "transport close") {
            setIsReconnecting(true)

            // Increment connection attempts
            setConnectionAttempts((prev) => prev + 1)

            // If we've tried too many times, show an error
            if (connectionAttempts >= 5) {
              setError("Connection unstable. Please check your internet connection and try again.")
              setIsReconnecting(false)
              return
            }

            // Try to reconnect after a delay
            reconnectTimeoutRef.current = setTimeout(() => {
              console.log("Attempting to reconnect...")
              if (socketRef.current) {
                socketRef.current.connect()
              }
            }, 3000)
          }
        })

        socket.on("connect_error", (err) => {
          console.error("Socket.IO connection error:", err)
          setIsConnected(false)
          setIsReconnecting(true)

          // Increment connection attempts
          setConnectionAttempts((prev) => prev + 1)

          // If we've tried too many times, show an error
          if (connectionAttempts >= 5) {
            setError(`Connection error: Cannot connect to API server. Please check your internet connection.`)
            setIsReconnecting(false)
            return
          }

          // Try to reconnect after a delay
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log("Attempting to reconnect after error...")
            connectSocket()
          }, 3000)
        })

        socket.on("server_response", (data) => {
          console.log("Received API response:", data)
          const message = data.message || "No guidance available"
          setLastMessage(message)
          speakMessage(message)
        })

        // Set a timeout for initial connection
        const connectionTimeout = setTimeout(() => {
          if (socket.connected) return
          console.error("Socket.IO initial connection timeout")

          // If we're not connected after the timeout, try to reconnect
          setConnectionAttempts((prev) => prev + 1)

          if (connectionAttempts >= 5) {
            setError(`Connection timeout: Could not connect to API server. Please check your internet connection.`)
            setIsReconnecting(false)
            return
          }

          setIsReconnecting(true)
          connectSocket()
        }, 10000)

        return () => {
          clearTimeout(connectionTimeout)
        }
      } catch (err) {
        console.error("Error creating Socket.IO connection:", err)
        setError(`Connection error: ${err.message}. Please check your internet connection.`)
        setIsReconnecting(false)
      }
    }

    connectSocket()

    // Cleanup function
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }

      if (socketRef.current) {
        socketRef.current.disconnect()
        socketRef.current = null
      }

      setIsReconnecting(false)
    }
  }, [isActive, connectionAttempts])

  // Add network status monitoring for mobile devices
  useEffect(() => {
    const handleOnline = () => {
      console.log("Network is online")
      if (isActive && !isConnected) {
        // If we're active but not connected, try to reconnect
        if (socketRef.current) {
          socketRef.current.connect()
        }
      }
    }

    const handleOffline = () => {
      console.log("Network is offline")
      setError("Network connection lost. Please check your internet connection.")
      setIsConnected(false)
    }

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [isActive, isConnected])

  // Detect device type
  useEffect(() => {
    const detectDevice = () => {
      const userAgent = navigator.userAgent || navigator.vendor || window.opera || ""

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
      )
    }

    detectDevice()

    // Also detect on resize in case of orientation changes
    window.addEventListener("resize", detectDevice)

    return () => {
      window.removeEventListener("resize", detectDevice)
    }
  }, [])

  // Capture frame function - optimized for mobile performance
  async function captureFrame(videoElement) {
    return new Promise((resolve) => {
      const canvas = document.createElement("canvas")
      const ctx = canvas.getContext("2d")

      // Use smaller dimensions on mobile for better performance
      const scaleFactor = isMobile ? 0.5 : 1.0
      canvas.width = videoElement.videoWidth * scaleFactor
      canvas.height = videoElement.videoHeight * scaleFactor

      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height)

      canvas.toBlob(
        (blob) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve(reader.result)
          reader.readAsArrayBuffer(blob)
        },
        "image/webp",
        isMobile ? 0.7 : 0.8, // Lower quality on mobile for better performance
      )
    })
  }

  // Capture and send frames - optimized for mobile
  async function captureAndSendFiveFrames(videoElement) {
    try {
      if (isSpeaking) {
        console.log("Not capturing frames because speech is in progress")
        return
      }

      isCapturingRef.current = true
      console.log("Starting to capture frames")

      const frames = []
      // Capture fewer frames on mobile for better performance
      const frameCount = isMobile ? 3 : 5

      for (let i = 0; i < frameCount; i++) {
        const frame = await captureFrame(videoElement)
        frames.push(frame)
        // Longer delay between frames on mobile
        await new Promise((res) => setTimeout(res, isMobile ? 400 : 300))
      }

      console.log("Sending batch of", frames.length, "frames to API")
      if (socketRef.current && socketRef.current.connected) {
        socketRef.current.emit("send_frames_batch", { frames: frames })
      } else {
        console.error("Socket not connected, can't send frames")
        // Try to reconnect if we're not connected
        if (isActive && !isConnected && !isReconnecting) {
          setConnectionAttempts((prev) => prev + 1)
        }
      }
    } catch (err) {
      console.error("Error capturing frames:", err)
      setError("Error capturing frames from camera")
    } finally {
      isCapturingRef.current = false
    }
  }

  // Initialize camera with better error handling
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
          // First try with environment (back camera) constraint
          const backCameraStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: "environment",
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          })

          if (videoRef.current) {
            videoRef.current.srcObject = backCameraStream
            streamRef.current = backCameraStream
            setError(null)
            console.log("Back camera initialized successfully")

            try {
              await videoRef.current.play()
            } catch (playErr) {
              console.error("Error playing back camera video:", playErr)
            }
          }
          return
        } catch (err) {
          console.log("Could not access back camera, trying basic camera access")
        }
      } else {
        // For laptops/desktops
        console.log("Laptop/Desktop detected - requesting camera")

        try {
          const cameraStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: true,
          })

          if (videoRef.current) {
            videoRef.current.srcObject = cameraStream
            streamRef.current = cameraStream
            setError(null)
            console.log("Camera initialized successfully")

            try {
              await videoRef.current.play()
            } catch (playErr) {
              console.error("Error playing camera video:", playErr)
            }
          }
          return
        } catch (err) {
          console.error("Could not access camera:", err)
        }
      }

      // Last resort: try with any camera
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
      setError("Camera access error. Please check your camera permissions.")
      setIsActive(false)
    }
  }

  // List available devices for debugging
  const listAvailableDevices = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        console.log("enumerateDevices() not supported in this browser")
        return
      }

      const devices = await navigator.mediaDevices.enumerateDevices()
      const videoDevices = devices.filter((device) => device.kind === "videoinput")

      console.log("Available video devices:", videoDevices.length)
    } catch (err) {
      console.error("Error listing devices:", err)
    }
  }

  const startCaptureCycle = () => {
    if (!isActive || !isConnected || isSpeaking || isCapturingRef.current) {
      console.log("Not starting capture cycle")
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

  // Speech synthesis with better error handling
  const speakMessage = (message) => {
    if (!message) return

    console.log("Attempting to speak:", message)

    try {
      // Cancel any ongoing speech
      window.speechSynthesis.cancel()

      // Force set speaking state
      setIsSpeaking(true)

      // Create a new utterance
      const utterance = new SpeechSynthesisUtterance(message)
      utteranceRef.current = utterance

      // Set properties for better speech
      utterance.rate = isIOS ? 1.0 : 1.0
      utterance.pitch = 1.0
      utterance.volume = 1.0

      // Get available voices
      const voices = window.speechSynthesis.getVoices()

      // Try to select an appropriate voice
      if (voices && voices.length > 0) {
        let selectedVoice = null

        // Try to find an English voice
        selectedVoice = voices.find(
          (voice) => voice.lang.includes("en-US") || voice.lang.includes("en-GB") || voice.lang.includes("en"),
        )

        if (selectedVoice) {
          utterance.voice = selectedVoice
          console.log("Selected voice:", selectedVoice.name)
        }
      }

      // Handle speech completion
      utterance.onend = () => {
        console.log("Speech completed")
        setIsSpeaking(false)
        // Wait a short delay before starting next capture cycle
        setTimeout(startCaptureCycle, 500)
      }

      utterance.onerror = (event) => {
        console.error("Speech synthesis error:", event)
        setIsSpeaking(false)
        setTimeout(startCaptureCycle, 500)
      }

      // Speak the utterance
      speechSynthesis.speak(utterance)

      // iOS-specific workaround
      if (isIOS) {
        setTimeout(() => {
          try {
            speechSynthesis.pause()
            speechSynthesis.resume()
          } catch (e) {
            console.error("iOS speech workaround error:", e)
          }
        }, 100)
      }

      // Set a timeout to prevent hanging if speech doesn't complete
      const timeoutDuration = Math.max(5000, message.length * 100)
      setTimeout(() => {
        if (isSpeaking) {
          console.warn("Speech timeout reached, forcing next cycle")
          setIsSpeaking(false)
          startCaptureCycle()
        }
      }, timeoutDuration)
    } catch (err) {
      console.error("Speech error:", err)
      setIsSpeaking(false)
      setTimeout(startCaptureCycle, 500)
    }
  }

  // Initialize audio context (helps with mobile audio restrictions)
  const initAudio = () => {
    try {
      // Create a short audio context to "unlock" audio on iOS/Android
      const AudioContext = window.AudioContext || window.webkitAudioContext
      if (AudioContext) {
        const audioCtx = new AudioContext()

        // Create a short silent sound
        const oscillator = audioCtx.createOscillator()
        const gainNode = audioCtx.createGain()
        gainNode.gain.value = 0.01 // Very quiet but not silent
        oscillator.connect(gainNode)
        gainNode.connect(audioCtx.destination)

        // Play for a very short time
        oscillator.start(audioCtx.currentTime)
        oscillator.stop(audioCtx.currentTime + 0.05)

        console.log("Audio context initialized")

        // For iOS, we need to resume the audio context after user interaction
        if (isIOS && audioCtx.state === "suspended") {
          audioCtx.resume().then(() => console.log("AudioContext resumed successfully"))
        }
      }
    } catch (e) {
      console.error("Could not initialize audio context:", e)
    }
  }

  // Toggle active state
  const toggleActive = () => {
    const newState = !isActive
    setIsActive(newState)

    if (newState) {
      // Initialize audio context to help with mobile audio restrictions
      initAudio()

      // Initialize speech synthesis when activating
      if (window.speechSynthesis) {
        // Force load voices
        window.speechSynthesis.getVoices()
      }

      // Reset connection attempts
      setConnectionAttempts(0)
      setIsReconnecting(false)

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

      if (socketRef.current) {
        socketRef.current.disconnect()
        socketRef.current = null
      }

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }

      if (window.speechSynthesis) {
        window.speechSynthesis.cancel()
      }

      setIsSpeaking(false)
      setIsReconnecting(false)
      setConnectionAttempts(0)
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
        socketRef.current = null
      }

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
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
      // For mobile, try to play the video
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

  // Test speech function
  const handleTestSpeech = () => {
    setSpeechStatus("Testing...")

    try {
      // Initialize audio context first (important for mobile)
      initAudio()

      // Cancel any ongoing speech
      window.speechSynthesis.cancel()

      const testMessage = "This is a test of the speech system. If you can hear this, speech is working correctly."

      // Create a new utterance
      const testUtterance = new SpeechSynthesisUtterance(testMessage)
      testUtterance.volume = 1.0
      testUtterance.rate = 1.0
      testUtterance.pitch = 1.0

      // Set up event handlers
      testUtterance.onstart = () => {
        console.log("Speech started")
        setSpeechStatus("Speaking...")
      }

      testUtterance.onend = () => {
        console.log("Speech ended successfully")
        setSpeechStatus("Success! Speech is working.")
      }

      testUtterance.onerror = (event) => {
        console.error("Speech error:", event)
        setSpeechStatus("Error: Speech failed")
      }

      // Try to select a voice
      const voices = window.speechSynthesis.getVoices()
      if (voices && voices.length > 0) {
        // Try to find an English voice
        const englishVoice = voices.find(
          (voice) => voice.lang.includes("en-US") || voice.lang.includes("en-GB") || voice.lang.includes("en"),
        )

        if (englishVoice) {
          testUtterance.voice = englishVoice
        }
      }

      // Speak the utterance
      window.speechSynthesis.speak(testUtterance)

      // iOS-specific workaround
      if (isIOS) {
        setTimeout(() => {
          try {
            window.speechSynthesis.pause()
            window.speechSynthesis.resume()
          } catch (e) {
            console.error("iOS speech workaround error:", e)
          }
        }, 100)
      }
    } catch (err) {
      console.error("Test speech error:", err)
      setSpeechStatus("Error: " + (err.message || "Unknown error"))
    }
  }

  return (
    <div className="flex flex-col gap-4 max-w-full mx-auto">
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
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" checked={isActive} onChange={toggleActive} />
              <div className="w-14 h-8 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-6 peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-emerald-500"></div>
            </label>
            <span className="text-lg font-medium">{isActive ? "Active" : "Inactive"}</span>
          </div>
        </div>

        {/* Larger camera view - taking up more screen space */}
        <div
          className="relative bg-black rounded-lg overflow-hidden w-full"
          style={{ height: "75vh" }}
          onClick={handleVideoClick}
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

        {/* Enhanced test speech section */}
        {/* <div className="p-4 bg-blue-50 rounded-lg">
          <h3 className="font-medium mb-2">Speech Test</h3>
          <p className="text-sm mb-3">
            If the app isn't speaking, tap the button below to test speech functionality. This will help diagnose any
            issues with your device's speech capabilities.
          </p>
          <div className="flex flex-col gap-2">
            <button
              className="w-full py-3 text-base font-medium rounded-md text-white bg-blue-500 hover:bg-blue-600 active:bg-blue-700"
              onClick={handleTestSpeech}
            >
              Test Speech Now
            </button>
            <div className="text-sm mt-1">
              Status:{" "}
              <span
                className={
                  speechStatus.includes("Success")
                    ? "text-green-600 font-medium"
                    : speechStatus.includes("Error")
                      ? "text-red-600 font-medium"
                      : "text-blue-600 font-medium"
                }
              >
                {speechStatus}
              </span>
            </div>
          </div>
        </div> */}

        {lastMessage && (
          <div className="p-4 bg-slate-100 rounded-lg">
            <h3 className="font-medium mb-1">Last Guidance:</h3>
            <p>{lastMessage}</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default NavigationAssistant
