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

  // Performance metrics state
  const [performanceMetrics, setPerformanceMetrics] = useState([])
  const [showPerformanceMetrics, setShowPerformanceMetrics] = useState(false)
  const [performanceSummary, setPerformanceSummary] = useState({
    avgUploadTime: 0,
    avgProcessingTime: 0,
    avgDownloadTime: 0,
    avgTotalTime: 0,
    totalFrames: 0,
  })

  // Add these state variables after the other state declarations (around line 20)
  const [processingTimes, setProcessingTimes] = useState([])
  const [currentProcessingTime, setCurrentProcessingTime] = useState(null)
  const [averageProcessingTime, setAverageProcessingTime] = useState(null)
  const frameTimestampsRef = useRef({})

  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const socketRef = useRef(null)
  const isCapturingRef = useRef(false)
  const utteranceRef = useRef(null)
  const reconnectTimeoutRef = useRef(null)

  // Performance tracking refs
  const pendingUploadsRef = useRef(new Map())
  const pendingProcessingRef = useRef(new Map())
  const maxMetricsRef = useRef(100) // Store up to 100 metrics

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

        // Modified server_response handler with performance tracking
        socket.on("server_response", (data) => {
          console.log("Received API response:", data)

          // Calculate processing time if we have a frameId
          if (data.frameId && frameTimestampsRef.current[data.frameId]) {
            const endTime = performance.now()
            const startTime = frameTimestampsRef.current[data.frameId].sendTime
            const processingTime = endTime - startTime

            // Update processing times
            setProcessingTimes((prev) => {
              const newTimes = [...prev, processingTime]
              // Keep only the last 10 times
              if (newTimes.length > 10) {
                return newTimes.slice(-10)
              }
              return newTimes
            })

            // Update current processing time
            setCurrentProcessingTime(`${processingTime.toFixed(0)} ms`)

            // Calculate and update average time
            setAverageProcessingTime((prev) => {
              const newTimes = [...(prev ? processingTimes : []), processingTime]
              return calculateAverageTime(newTimes).toFixed(0)
            })

            // Clean up the timestamp reference
            delete frameTimestampsRef.current[data.frameId]
          }

          // Check if response contains performance data
          if (data.frameId && pendingProcessingRef.current.has(data.frameId)) {
            // Complete the performance tracking for this frame
            completeOperation(data.frameId, data.processingTime)
          }

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

  // Add these functions after the device detection useEffect

  // Calculate performance summary
  useEffect(() => {
    if (performanceMetrics.length > 0) {
      const totalFrames = performanceMetrics.length
      const avgUploadTime = performanceMetrics.reduce((sum, metric) => sum + metric.uploadTime, 0) / totalFrames
      const avgProcessingTime = performanceMetrics.reduce((sum, metric) => sum + metric.processingTime, 0) / totalFrames
      const avgDownloadTime = performanceMetrics.reduce((sum, metric) => sum + metric.downloadTime, 0) / totalFrames
      const avgTotalTime = performanceMetrics.reduce((sum, metric) => sum + metric.totalTime, 0) / totalFrames

      setPerformanceSummary({
        avgUploadTime,
        avgProcessingTime,
        avgDownloadTime,
        avgTotalTime,
        totalFrames,
      })
    }
  }, [performanceMetrics])

  // Performance tracking functions
  const startUpload = (frameId, size) => {
    pendingUploadsRef.current.set(frameId, {
      startTime: performance.now(),
      size,
    })
    return frameId
  }

  const completeUpload = (frameId) => {
    const upload = pendingUploadsRef.current.get(frameId)
    if (!upload) return

    const uploadTime = performance.now() - upload.startTime
    pendingProcessingRef.current.set(frameId, {
      startTime: performance.now(),
      uploadTime,
      size: upload.size,
    })

    pendingUploadsRef.current.delete(frameId)
  }

  const completeOperation = (frameId, serverProcessingTime = 0) => {
    const processing = pendingProcessingRef.current.get(frameId)
    if (!processing) return

    const endTime = performance.now()
    const clientProcessingTime = endTime - processing.startTime
    const processingTime = serverProcessingTime || clientProcessingTime
    const downloadTime = clientProcessingTime - processingTime > 0 ? clientProcessingTime - processingTime : 0
    const totalTime = processing.uploadTime + processingTime + downloadTime

    const newMetric = {
      id: frameId,
      timestamp: Date.now(),
      uploadTime: processing.uploadTime,
      processingTime,
      downloadTime,
      totalTime,
      frameSize: processing.size,
      networkQuality: assessNetworkQuality(processing.uploadTime),
    }

    setPerformanceMetrics((prev) => {
      const updated = [...prev, newMetric]
      // Keep only the last maxMetrics
      return updated.length > maxMetricsRef.current ? updated.slice(-maxMetricsRef.current) : updated
    })

    pendingProcessingRef.current.delete(frameId)
    return newMetric
  }

  const assessNetworkQuality = (uploadTime) => {
    if (uploadTime < 100) return "Good"
    if (uploadTime < 300) return "Fair"
    return "Poor"
  }

  const clearPerformanceMetrics = () => {
    setPerformanceMetrics([])
    pendingUploadsRef.current.clear()
    pendingProcessingRef.current.clear()
  }

  // Add this function to calculate average processing time (after other utility functions)
  const calculateAverageTime = (times) => {
    if (times.length === 0) return 0
    const sum = times.reduce((acc, time) => acc + time, 0)
    return sum / times.length
  }

  // Add this useEffect to initialize speech synthesis as early as possible
  // Add this after the device detection useEffect
  useEffect(() => {
    // Try to initialize speech synthesis as early as possible
    if (window.speechSynthesis) {
      console.log("Pre-loading speech synthesis voices")

      // Force load voices
      const voices = window.speechSynthesis.getVoices()
      console.log("Available voices:", voices.length)

      // Set up voice changed event listener
      if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = () => {
          const updatedVoices = window.speechSynthesis.getVoices()
          console.log("Voices loaded:", updatedVoices.length)
        }
      }

      // For iOS, we need to periodically "ping" the speech synthesis
      // to prevent it from going to sleep
      let speechKeepAliveInterval

      if (isIOS) {
        speechKeepAliveInterval = setInterval(() => {
          if (!isSpeaking) {
            // This helps keep the system active on iOS
            speechSynthesis.cancel()
          }
        }, 10000)
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
        // Generate a unique ID for this batch of frames
        const frameId = `frame-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`

        // Start timing when we send the frames
        frameTimestampsRef.current[frameId] = {
          sendTime: performance.now(),
          size: frames.reduce((sum, frame) => sum + frame.byteLength, 0),
        }

        // Set current processing time to null to indicate processing has started
        setCurrentProcessingTime("Processing...")

        // Send frames with the ID
        socketRef.current.emit("send_frames_batch", {
          frames: frames,
          frameId: frameId,
          timestamp: Date.now(),
        })
        // Mark upload as complete
        completeUpload(frameId)
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
              (voice.name.includes("Google") && voice.lang.includes("en")) ||
              voice.name.includes("English United States"),
          )
        }

        // Fallback to any English voice
        if (!selectedVoice) {
          selectedVoice = voices.find(
            (voice) => voice.lang.includes("en-US") || voice.lang.includes("en-GB") || voice.lang.includes("en"),
          )
        }

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
      // Reset performance metrics when starting
      clearPerformanceMetrics()

      // Initialize audio context to help with mobile audio restrictions
      initAudio()

      // Initialize speech synthesis when activating - this is the key part that makes speech work
      if (window.speechSynthesis) {
        // Force load voices
        window.speechSynthesis.getVoices()

        // Speak a silent utterance to initialize the speech system on mobile
        // This is crucial for iOS - it needs a speech command triggered by user interaction
        const initUtterance = new SpeechSynthesisUtterance(" ")
        initUtterance.volume = 0.1
        initUtterance.onend = () => {
          console.log("Initial speech completed - speech system initialized")
          // Try a very short test message to fully initialize the speech system
          const testUtterance = new SpeechSynthesisUtterance("Ready")
          testUtterance.volume = 1.0
          testUtterance.onend = () => {
            console.log("Speech system fully initialized")
          }
          window.speechSynthesis.speak(testUtterance)
        }
        window.speechSynthesis.speak(initUtterance)
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

  // Add this function to automatically trigger speech initialization
  const triggerSpeechInit = () => {
    if (!window.speechSynthesis) return

    try {
      // Create a silent utterance
      const silentUtterance = new SpeechSynthesisUtterance(" ")
      silentUtterance.volume = 0
      silentUtterance.onend = () => {
        console.log("Silent speech initialization complete")
      }
      window.speechSynthesis.speak(silentUtterance)
    } catch (e) {
      console.error("Error in speech initialization:", e)
    }
  }

  // Add the performance metrics dashboard component
  const PerformanceMetricsDashboard = () => {
    if (!showPerformanceMetrics) return null

    // Calculate additional stats
    const maxTotalTime = performanceMetrics.length > 0 ? Math.max(...performanceMetrics.map((m) => m.totalTime)) : 0

    const minTotalTime = performanceMetrics.length > 0 ? Math.min(...performanceMetrics.map((m) => m.totalTime)) : 0

    // Get the last 10 metrics for recent performance
    const recentMetrics = performanceMetrics.slice(-10)

    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
        <div className="bg-white rounded-lg w-full max-w-4xl max-h-[90vh] overflow-y-auto">
          <div className="p-4 border-b flex justify-between items-center">
            <div>
              <h2 className="text-xl font-bold">Performance Metrics Dashboard</h2>
              <p className="text-sm text-gray-500">Monitoring image upload, processing, and download times</p>
            </div>
            <button
              className="px-3 py-1 bg-gray-200 hover:bg-gray-300 rounded-md text-sm"
              onClick={() => setShowPerformanceMetrics(false)}
            >
              Close
            </button>
          </div>

          <div className="p-4">
            {performanceMetrics.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="h-12 w-12 text-gray-300 mb-4">⏱️</div>
                <p className="text-gray-500">No performance data available yet</p>
                <p className="text-gray-400 text-sm mt-2">
                  Start the navigation assistant to collect performance metrics
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                  <div className="bg-slate-50 p-4 rounded-lg">
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Average Times (ms)</h3>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-xs text-gray-500">Upload</p>
                        <p className="text-xl font-semibold">{performanceSummary.avgUploadTime.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Processing</p>
                        <p className="text-xl font-semibold">{performanceSummary.avgProcessingTime.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Download</p>
                        <p className="text-xl font-semibold">{performanceSummary.avgDownloadTime.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Total</p>
                        <p className="text-xl font-semibold">{performanceSummary.avgTotalTime.toFixed(2)}</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-50 p-4 rounded-lg">
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Summary</h3>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-xs text-gray-500">Total Frames</p>
                        <p className="text-xl font-semibold">{performanceSummary.totalFrames}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Min Time (ms)</p>
                        <p className="text-xl font-semibold">{minTotalTime.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Max Time (ms)</p>
                        <p className="text-xl font-semibold">{maxTotalTime.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Last Frame</p>
                        <p className="text-xl font-semibold">
                          {performanceMetrics.length > 0
                            ? new Date(performanceMetrics[performanceMetrics.length - 1].timestamp).toLocaleTimeString()
                            : "-"}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="overflow-auto max-h-60 bg-slate-50 p-4 rounded-lg mb-4">
                  <h3 className="text-sm font-medium text-gray-500 mb-4">Recent Performance Data (Last 10 Frames)</h3>
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Frame
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Time
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Upload (ms)
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Processing (ms)
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Download (ms)
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Total (ms)
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {recentMetrics.map((metric, index) => (
                        <tr key={metric.id}>
                          <td className="px-3 py-2 whitespace-nowrap text-xs">
                            {performanceMetrics.length - recentMetrics.length + index + 1}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-xs">
                            {new Date(metric.timestamp).toLocaleTimeString()}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-xs">{metric.uploadTime.toFixed(2)}</td>
                          <td className="px-3 py-2 whitespace-nowrap text-xs">{metric.processingTime.toFixed(2)}</td>
                          <td className="px-3 py-2 whitespace-nowrap text-xs">{metric.downloadTime.toFixed(2)}</td>
                          <td className="px-3 py-2 whitespace-nowrap text-xs">{metric.totalTime.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <button
                  className="w-full py-3 bg-gray-200 hover:bg-gray-300 rounded-md text-sm"
                  onClick={clearPerformanceMetrics}
                >
                  Clear Performance Metrics
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Modify the return statement to include a hidden button that can be programmatically clicked
  // Add this to the return statement, right after the main button
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

          {/* Performance metrics button */}
          <button
            className="flex items-center gap-1 px-3 py-1 bg-slate-100 hover:bg-slate-200 rounded-md text-sm"
            onClick={() => setShowPerformanceMetrics(true)}
          >
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
            >
              <line x1="18" y1="20" x2="18" y2="10"></line>
              <line x1="12" y1="20" x2="12" y2="4"></line>
              <line x1="6" y1="20" x2="6" y2="14"></line>
            </svg>
            <span>Metrics</span>
            {performanceMetrics.length > 0 && (
              <span className="ml-1 bg-slate-200 text-slate-700 rounded-full px-1.5 py-0.5 text-xs">
                {performanceMetrics.length}
              </span>
            )}
          </button>
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

        {/* Hidden button for speech initialization - can be removed from UI but keep the functionality */}
        <button
          className="hidden"
          ref={(btn) => {
            // Auto-click this hidden button when isActive changes to true
            if (btn && isActive) {
              setTimeout(() => {
                btn.click()
              }, 500)
            }
          }}
          onClick={triggerSpeechInit}
        >
          Initialize Speech
        </button>

        {/* You can remove the test speech section if you want, or keep it */}
        {/* Enhanced test speech section */}
        <div className="p-4 bg-blue-50 rounded-lg">
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
        </div>

        {/* Processing time display */}
        <div className="p-4 bg-slate-100 rounded-lg">
          <h3 className="font-medium mb-1">Image Processing Times:</h3>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-sm text-gray-500">Current:</p>
              <p className="text-lg font-medium">{currentProcessingTime || "N/A"}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Average (last 10):</p>
              <p className="text-lg font-medium">{averageProcessingTime ? `${averageProcessingTime} ms` : "N/A"}</p>
            </div>
          </div>
        </div>

        {lastMessage && (
          <div className="p-4 bg-slate-100 rounded-lg">
            <h3 className="font-medium mb-1">Last Guidance:</h3>
            <p>{lastMessage}</p>
          </div>
        )}
      </div>

      <PerformanceMetricsDashboard />
    </div>
  )
}

export default NavigationAssistant
