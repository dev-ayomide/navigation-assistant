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
  const [serverAddress, setServerAddress] = useState("http://192.168.179.70:5000")
  const [showSettings, setShowSettings] = useState(false)

  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const socketRef = useRef(null)
  const isCapturingRef = useRef(false)
  const utteranceRef = useRef(null)
  const serverInputRef = useRef(null)

  // Socket.IO connection - connect to Flask server
  useEffect(() => {
    if (!isActive) return

    // Disconnect any existing socket
    if (socketRef.current) {
      socketRef.current.disconnect()
    }

    try {
      console.log(`Attempting to connect to server at: ${serverAddress}`)

      // Create socket with explicit options for better compatibility
      const socket = io("see-for-me-api-production.up.railway.app", {
        reconnectionAttempts: 5,
        timeout: 10000,
        transports: ["websocket", "polling"],
        upgrade: true,
        forceNew: true,
      })

      socketRef.current = socket

      socket.on("connect", () => {
        console.log("Socket.IO connected successfully!")
        setIsConnected(true)
        setError(null)
      })

      socket.on("disconnect", () => {
        console.log("Socket.IO disconnected from server")
        setIsConnected(false)
      })

      socket.on("connect_error", (err) => {
        console.error("Socket.IO connection error:", err)
        setError(
          `Connection error: Cannot connect to server at ${serverAddress}. Please check the server address and ensure the server is running.`,
        )
        setIsConnected(false)
      })

      socket.on("server_response", (data) => {
        console.log("Received server response:", data)
        const message = data.message || "No guidance available"
        setLastMessage(message)
        speakMessage(message)
      })

      // Set a timeout for connection
      const connectionTimeout = setTimeout(() => {
        if (socket.connected) return
        console.error("Socket.IO connection timeout")
        setError(
          `Connection timeout: Could not connect to server at ${serverAddress} within 10 seconds. Please check the server address and ensure the server is running.`,
        )
      }, 10000)

      return () => {
        clearTimeout(connectionTimeout)
        socket.disconnect()
        socketRef.current = null
      }
    } catch (err) {
      console.error("Error creating Socket.IO connection:", err)
      setError(`Connection error: ${err.message}. Please check the server address.`)
      return () => {}
    }
  }, [isActive, serverAddress])

  // Detect device type
  useEffect(() => {
    const detectDevice = () => {
      const userAgent = navigator.userAgent || window.opera
      const isIOSDevice =
        /iphone|ipad|ipod/i.test(userAgent.toLowerCase()) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
      const isAndroidDevice = /android/i.test(userAgent.toLowerCase())
      const isMobileDevice =
        isIOSDevice ||
        isAndroidDevice ||
        /webos|blackberry|iemobile|opera mini/i.test(userAgent.toLowerCase()) ||
        "ontouchstart" in window

      setIsMobile(isMobileDevice)
      setIsIOS(isIOSDevice)
      setIsAndroid(isAndroidDevice)

      console.log(
        "Device detected as:",
        isIOSDevice ? "iOS mobile" : isAndroidDevice ? "Android mobile" : isMobileDevice ? "Other mobile" : "desktop",
      )
    }

    detectDevice()
  }, [])

  // Capture frame function
  async function captureFrame(videoElement) {
    return new Promise((resolve) => {
      const canvas = document.createElement("canvas")
      const ctx = canvas.getContext("2d")
      canvas.width = videoElement.videoWidth
      canvas.height = videoElement.videoHeight

      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height)

      canvas.toBlob((blob) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result)
        reader.readAsArrayBuffer(blob)
      }, "image/webp")
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

      console.log("Sending batch of", frames.length, "frames to Flask server")
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

  // Initialize camera with simplified approach for Android
  const initCamera = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Camera access is not supported by this browser")
      }

      setCameraPermissionRequested(true)

      // For Android, use the simplest approach first
      if (isAndroid) {
        console.log("Android detected - using simplified camera approach")

        try {
          // Start with the most basic request
          console.log("Requesting basic camera access for Android")
          const basicStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: true,
          })

          if (videoRef.current) {
            videoRef.current.srcObject = basicStream
            streamRef.current = basicStream
            setError(null)

            // On Android, explicitly play the video
            try {
              await videoRef.current.play()
              console.log("Video playback started successfully")

              // Now try to switch to back camera if possible
              setTimeout(async () => {
                try {
                  console.log("Attempting to switch to back camera")
                  const backCameraStream = await navigator.mediaDevices.getUserMedia({
                    audio: false,
                    video: { facingMode: "environment" },
                  })

                  // Stop old tracks
                  basicStream.getVideoTracks().forEach((track) => track.stop())

                  // Set new stream
                  videoRef.current.srcObject = backCameraStream
                  streamRef.current = backCameraStream

                  try {
                    await videoRef.current.play()
                    console.log("Back camera video started successfully")
                  } catch (playErr) {
                    console.error("Error playing back camera video:", playErr)
                  }
                } catch (backCameraErr) {
                  console.warn("Could not switch to back camera, using default", backCameraErr)
                  // Continue with front camera
                }
              }, 500)
            } catch (playErr) {
              console.error("Error playing video:", playErr)
              // Don't throw here, just log it
            }
          }
          return // Exit early if successful
        } catch (androidErr) {
          console.error("Android basic camera access failed:", androidErr)
          throw new Error(`Android camera error: ${androidErr.name}. Please check Chrome camera permissions.`)
        }
      }

      // iOS-specific handling
      if (isIOS) {
        console.log("iOS detected - using iOS-specific camera handling")

        try {
          // For iOS, start with the absolute simplest request
          console.log("Requesting basic camera access for iOS")
          const basicStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: true,
          })

          if (videoRef.current) {
            videoRef.current.srcObject = basicStream
            streamRef.current = basicStream
            setError(null)

            // On iOS, we need to explicitly play the video
            try {
              await videoRef.current.play()
              console.log("Video playback started successfully")
            } catch (playErr) {
              console.error("Error playing video:", playErr)
              // Don't throw here, just log it
            }

            // Now try to get the back camera if possible
            setTimeout(async () => {
              try {
                console.log("Attempting to switch to back camera")
                const backCameraStream = await navigator.mediaDevices.getUserMedia({
                  audio: false,
                  video: { facingMode: "environment" },
                })

                // Stop old tracks
                basicStream.getVideoTracks().forEach((track) => track.stop())

                // Set new stream
                videoRef.current.srcObject = backCameraStream
                streamRef.current = backCameraStream

                try {
                  await videoRef.current.play()
                } catch (playErr) {
                  console.error("Error playing back camera video:", playErr)
                }
              } catch (backCameraErr) {
                console.warn("Could not switch to back camera, using default", backCameraErr)
                // Continue with front camera
              }
            }, 500)
          }
          return // Exit early if successful
        } catch (iosErr) {
          console.error("iOS basic camera access failed:", iosErr)
          throw new Error(
            `iOS camera error: ${iosErr.name}. Please check Safari camera permissions in your device settings.`,
          )
        }
      }

      // Non-mobile devices continue with normal flow
      const constraints = {
        audio: false,
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      }

      console.log("Requesting camera with constraints:", JSON.stringify(constraints))
      const stream = await navigator.mediaDevices.getUserMedia(constraints)

      // Check if we got a video track
      const videoTracks = stream.getVideoTracks()
      if (videoTracks.length === 0) {
        throw new Error("No video track available in the media stream")
      }

      console.log("Camera accessed successfully. Video tracks:", videoTracks.length)
      console.log("Camera settings:", videoTracks[0].getSettings())

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        streamRef.current = stream
        setError(null)
      }
    } catch (err) {
      console.error("Camera initialization error:", err)

      let errorMessage = "Camera access error"

      // Device-specific error handling
      if (isAndroid) {
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          errorMessage =
            "Camera access denied. On Android Chrome, please:\n1. Tap the lock icon in the address bar\n2. Select 'Site settings'\n3. Enable camera access\n4. Reload the page"
        } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
          errorMessage = "Camera is in use by another app. Please close any apps using the camera and try again."
        } else if (err.name === "OverconstrainedError" || err.name === "ConstraintNotSatisfiedError") {
          errorMessage = "Your device doesn't support the requested camera mode. Please try a different browser."
        } else if (err.message && err.message.includes("Android camera error")) {
          errorMessage = err.message
        } else {
          errorMessage = "Android camera error. Please check your camera permissions in Chrome settings."
        }
      } else if (isIOS) {
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          errorMessage = "Camera access denied. On iOS, go to Settings > Safari > Camera and ensure it's allowed."
        } else if (err.message && err.message.includes("iOS camera error")) {
          errorMessage = err.message
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
      } else if (err.name === "TypeError" && err.message.includes("mediaDevices")) {
        errorMessage = "Camera API not available. Try using HTTPS or a different browser."
      } else if (err.name === "AbortError") {
        errorMessage = "Camera access was aborted. Please try again."
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

    const utterance = new SpeechSynthesisUtterance(message)
    utteranceRef.current = utterance

    // Try to select a clear voice if available
    let voices = window.speechSynthesis.getVoices()
    console.log("Available voices:", voices.length)

    // If no voices are available yet, wait a moment and try again (common issue on mobile)
    if (voices.length === 0) {
      console.log("No voices available yet, waiting...")
      setTimeout(() => {
        voices = window.speechSynthesis.getVoices()
        console.log("Voices after waiting:", voices.length)

        // Try to find a good voice
        selectVoice(utterance, voices)

        // Continue with speech
        continueSpeech(utterance, message)
      }, 1000)
    } else {
      // Voices are available, proceed normally
      selectVoice(utterance, voices)
      continueSpeech(utterance, message)
    }
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

  // Toggle active state
  const toggleActive = () => {
    const newState = !isActive
    setIsActive(newState)

    if (newState) {
      // Initialize audio context to help with mobile audio restrictions
      initAudio()

      // List available devices for debugging
      listAvailableDevices().then(() => {
        initCamera()
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

  // Handle server address update
  const updateServerAddress = () => {
    if (serverInputRef.current && serverInputRef.current.value) {
      const newAddress = serverInputRef.current.value.trim()
      if (newAddress !== serverAddress) {
        console.log(`Updating server address from ${serverAddress} to ${newAddress}`)
        setServerAddress(newAddress)

        // If active, reconnect
        if (isActive) {
          if (socketRef.current) {
            socketRef.current.disconnect()
          }
          setIsConnected(false)
        }
      }
      setShowSettings(false)
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
                <li>Make sure your Flask server is running</li>
                <li>Verify the server address is correct (currently: {serverAddress})</li>
                <li>Ensure your phone and computer are on the same network</li>
                <li>Check if any firewall is blocking the connection</li>
                <li>
                  <button className="text-blue-600 underline" onClick={() => setShowSettings(true)}>
                    Click here to update server address
                  </button>
                </li>
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

      {showSettings && (
        <div className="p-4 bg-blue-50 rounded-md">
          <h3 className="font-medium mb-2">Server Settings</h3>
          <div className="flex flex-col gap-2">
            <label className="text-sm text-gray-600">Server Address (include http:// and port)</label>
            <div className="flex gap-2">
              <input
                ref={serverInputRef}
                type="text"
                className="flex-1 p-2 border rounded"
                defaultValue={serverAddress}
                placeholder="http://192.168.x.x:5000"
              />
              <button className="bg-blue-500 text-white px-3 py-2 rounded" onClick={updateServerAddress}>
                Save
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              This should be the IP address and port of your Flask server. Example: http://192.168.1.100:5000
            </p>
          </div>
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
                    <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path>
                    <path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path>
                    <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path>
                    <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
                    <line x1="12" y1="20" x2="12.01" y2="20"></line>
                  </>
                )}
              </svg>
              <span>{isConnected ? "Connected" : "Disconnected"}</span>
            </div>

            <button
              onClick={() => setShowSettings(!showSettings)}
              className="text-gray-500 hover:text-gray-700"
              aria-label="Settings"
            >
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
              >
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
            </button>
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
            Device: {isIOS ? "iOS" : isAndroid ? "Android" : isMobile ? "Mobile" : "Desktop"}
            {isAndroid && " • Chrome requires camera permissions"}
            {isIOS && " • Safari requires camera permissions"}
            {cameraPermissionRequested && !error && " • Camera permission requested"}
          </p>
          <p className="text-sm text-gray-500 mb-2">
            Server: {serverAddress} • {isConnected ? "Connected" : "Disconnected"}
            {!isConnected && (
              <button className="ml-2 text-blue-600 underline" onClick={() => setShowSettings(true)}>
                Change
              </button>
            )}
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
