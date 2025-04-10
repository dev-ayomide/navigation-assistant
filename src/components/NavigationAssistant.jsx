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

  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const socketRef = useRef(null)
  const isCapturingRef = useRef(false)
  const utteranceRef = useRef(null)

  // Socket.IO connection - connect to your Flask server
  useEffect(() => {
    if (!isActive) return

    // Use the IP address shown in your Vite output
    // Make sure to replace this with your actual computer's IP address
    const socket = io("see-for-me-api-production.up.railway.app")
    socketRef.current = socket

    socket.on("connect", () => {
      setIsConnected(true)
      setError(null)
      console.log("Socket connected to Flask server")
    })

    socket.on("disconnect", () => {
      setIsConnected(false)
      console.log("Socket disconnected from Flask server")
    })

    socket.on("connect_error", (err) => {
      console.error("Socket connection error:", err)
      setError("Connection error. Please try again.")
      setIsConnected(false)
    })

    socket.on("server_response", (data) => {
      console.log("Received server response:", data)
      const message = data.message || "No guidance available"
      setLastMessage(message)
      speakMessage(message)
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [isActive])

  // Detect device type more accurately
  useEffect(() => {
    const detectDevice = () => {
      const userAgent = navigator.userAgent || window.opera
      const isIOSDevice = /iphone|ipad|ipod/i.test(userAgent.toLowerCase()) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
      const isAndroidDevice = /android/i.test(userAgent.toLowerCase())
      const isMobileDevice = isIOSDevice || isAndroidDevice || /webos|blackberry|iemobile|opera mini/i.test(userAgent.toLowerCase()) || ('ontouchstart' in window)

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

  // Initialize camera with device-specific handling
  const initCamera = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Camera access is not supported by this browser")
      }

      setCameraPermissionRequested(true)

      // Set constraints based on device type
      let constraints = {}

      if (isIOS) {
        console.log("Using iOS-specific camera constraints")
        // iOS Safari has issues with exact constraints, use simpler ones
        constraints = {
          audio: false,
          video: true, // Start with basic video request for iOS
        }
      } else if (isAndroid) {
        console.log("Using Android-specific camera constraints")
        // For Android, we'll try a more direct approach
        constraints = {
          audio: false,
          video: {
            // On Android, we need to be explicit about wanting the back camera
            facingMode: { exact: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        }
      } else if (isMobile) {
        console.log("Using generic mobile camera constraints")
        constraints = {
          audio: false,
          video: {
            facingMode: "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        }
      } else {
        console.log("Using desktop camera constraints")
        constraints = {
          audio: false,
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        }
      }

      console.log("Requesting camera with constraints:", JSON.stringify(constraints))

      try {
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

          // For mobile devices, explicitly play the video
          try {
            await videoRef.current.play()
            console.log("Video playback started successfully")
          } catch (playErr) {
            console.error("Error playing video:", playErr)
            // Don't throw here, just log it
          }
        }
      } catch (err) {
        console.error("Primary camera request failed:", err)

        // If the exact "environment" constraint fails on Android, try without "exact"
        if (isAndroid && (err.name === "OverconstrainedError" || err.name === "ConstraintNotSatisfiedError")) {
          console.log("Exact environment mode failed on Android, trying fallback...")
          try {
            const fallbackConstraints = {
              audio: false,
              video: {
                facingMode: "environment", // Try without "exact"
                width: { ideal: 1280 },
                height: { ideal: 720 },
              },
            }

            console.log("Requesting camera with fallback constraints:", JSON.stringify(fallbackConstraints))
            const stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints)

            if (videoRef.current) {
              videoRef.current.srcObject = stream
              streamRef.current = stream
              setError(null)

              try {
                await videoRef.current.play()
                console.log("Video playback started successfully with fallback")
              } catch (playErr) {
                console.error("Error playing video with fallback:", playErr)
              }
              return // Exit early if successful
            }
          } catch (fallbackErr) {
            console.error("Fallback camera initialization also failed:", fallbackErr)

            // Try with the most basic constraints as a last resort
            try {
              console.log("Trying with basic video constraints")
              const basicStream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: true,
              })

              if (videoRef.current) {
                videoRef.current.srcObject = basicStream
                streamRef.current = basicStream
                setError(null)

                try {
                  await videoRef.current.play()
                  console.log("Video playback started successfully with basic constraints")
                } catch (playErr) {
                  console.error("Error playing video with basic constraints:", playErr)
                }
                return // Exit early if successful
              }
            } catch (basicErr) {
              console.error("Even basic camera initialization failed:", basicErr)
              throw basicErr // Re-throw to be caught by the outer catch
            }
          }
        } else {
          // For other errors or devices, just throw to the outer catch
          throw err
        }
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

    utterance.rate = 1.0
    utterance.pitch = 1.0
    utterance.volume = 1.0

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

    speechSynthesis.speak(utterance)

    const timeoutDuration = Math.max(5000, message.length * 100)
    setTimeout(() => {
      if (isSpeaking && utteranceRef.current === utterance) {
        console.warn("Speech timeout reached, forcing next cycle")
        setIsSpeaking(false)
        startCaptureCycle()
      }
    }, timeoutDuration)
  }

  // Toggle active state
  const toggleActive = () => {
    const newState = !isActive
    setIsActive(newState)

    if (newState) {
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
            <span className="font-medium">Camera Error</span>
          </div>
          <p>{error}</p>

          {isAndroid && (
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

          {isIOS && (
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

