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
  const [responseTime, setResponseTime] = useState(null)

  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const socketRef = useRef(null)
  const isCapturingRef = useRef(false)
  const utteranceRef = useRef(null)
  const requestTimestampRef = useRef(null)
  const audioContextRef = useRef(null)

  // Socket.IO connection - connect to your Flask server
  useEffect(() => {
    if (!isActive) return

    const socket = io("https://see-for-me-api-production.up.railway.app/")
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

      // Play completion sound
      playCompletionSound()

      // Trigger haptic feedback for completion if available
      if (navigator.vibrate) {
        navigator.vibrate([100, 50, 200])
      }

      // Calculate response time in seconds
      if (requestTimestampRef.current) {
        const elapsedTime = (Date.now() - requestTimestampRef.current) / 1000 // Convert to seconds
        setResponseTime(elapsedTime.toFixed(2)) // Format to 2 decimal places
        console.log(Response time: ${elapsedTime.toFixed(2)} seconds)
      }
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [isActive])

  // Initialize Audio Context for feedback sounds
  useEffect(() => {
    // Initialize AudioContext on first user interaction to comply with browser policies
    const initAudioContext = () => {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)()
      }
    }

    // Add event listeners for user interaction
    const handleUserInteraction = () => {
      initAudioContext()
      // Remove event listeners after initialization
      document.removeEventListener("click", handleUserInteraction)
      document.removeEventListener("touchstart", handleUserInteraction)
    }

    document.addEventListener("click", handleUserInteraction)
    document.addEventListener("touchstart", handleUserInteraction)

    return () => {
      document.removeEventListener("click", handleUserInteraction)
      document.removeEventListener("touchstart", handleUserInteraction)
      if (audioContextRef.current) {
        audioContextRef.current.close()
      }
    }
  }, [])

  // Play start sound function
  const playStartSound = () => {
    if (!audioContextRef.current) return

    const oscillator = audioContextRef.current.createOscillator()
    const gainNode = audioContextRef.current.createGain()

    oscillator.type = "sine"
    oscillator.frequency.setValueAtTime(440, audioContextRef.current.currentTime) // A4 note
    oscillator.frequency.exponentialRampToValueAtTime(880, audioContextRef.current.currentTime + 0.2) // Ramp up to A5

    gainNode.gain.setValueAtTime(0.3, audioContextRef.current.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContextRef.current.currentTime + 0.3)

    oscillator.connect(gainNode)
    gainNode.connect(audioContextRef.current.destination)

    oscillator.start()
    oscillator.stop(audioContextRef.current.currentTime + 0.3)
  }

  // Play completion sound function
  const playCompletionSound = () => {
    if (!audioContextRef.current) return

    const oscillator = audioContextRef.current.createOscillator()
    const gainNode = audioContextRef.current.createGain()

    oscillator.type = "sine"
    oscillator.frequency.setValueAtTime(880, audioContextRef.current.currentTime) // A5 note
    oscillator.frequency.exponentialRampToValueAtTime(440, audioContextRef.current.currentTime + 0.3) // Ramp down to A4

    gainNode.gain.setValueAtTime(0.3, audioContextRef.current.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContextRef.current.currentTime + 0.4)

    oscillator.connect(gainNode)
    gainNode.connect(audioContextRef.current.destination)

    oscillator.start()
    oscillator.stop(audioContextRef.current.currentTime + 0.4)
  }

  // Capture high-quality frame function
  async function captureHighQualityFrame(videoElement) {
    return new Promise((resolve) => {
      const canvas = document.createElement("canvas")
      const ctx = canvas.getContext("2d")

      // Set to higher resolution for better quality
      canvas.width = videoElement.videoWidth
      canvas.height = videoElement.videoHeight

      // Draw the video frame to the canvas
      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height)

      // Convert to high-quality WebP format with minimal compression
      canvas.toBlob(
        (blob) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve(reader.result)
          reader.readAsArrayBuffer(blob)
        },
        "image/webp",
        0.95,
      ) // Using 0.95 quality (higher value = better quality)
    })
  }

  // Capture and send two high-quality frames
  async function captureAndSendTwoFrames(videoElement) {
    try {
      if (isSpeaking) {
        console.log("Not capturing frames because speech is in progress")
        return
      }

      isCapturingRef.current = true
      console.log("Starting to capture high-quality frames")

      // Play start sound and trigger haptic feedback
      playStartSound()
      if (navigator.vibrate) {
        navigator.vibrate(100) // Simple vibration for start
      }

      // Capture first frame
      const frame1 = await captureHighQualityFrame(videoElement)

      // Wait a moment before capturing second frame
      await new Promise((res) => setTimeout(res, 500))

      // Capture second frame
      const frame2 = await captureHighQualityFrame(videoElement)

      const frames = [frame1, frame2]

      console.log("Sending batch of", frames.length, "high-quality frames to Flask server")
      if (socketRef.current && socketRef.current.connected) {
        // Record the timestamp before sending the frames
        requestTimestampRef.current = Date.now()
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

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768)
    }

    checkMobile()
    window.addEventListener("resize", checkMobile)

    return () => {
      window.removeEventListener("resize", checkMobile)
    }
  }, [])

  // Initialize camera
  const initCamera = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Camera access is not supported by this browser")
      }

      const constraints = {
        video: {
          facingMode: isMobile ? "environment" : "user",
          width: { ideal: 1920 }, // Higher resolution for better quality
          height: { ideal: 1080 },
        },
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints)

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        streamRef.current = stream
        setError(null)
      }
    } catch (err) {
      console.error("Camera initialization error:", err)

      let errorMessage = "Camera access error"

      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        errorMessage = "Camera access denied. Please enable camera permissions."
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        errorMessage = "No camera found on this device."
      } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
        errorMessage = "Camera is already in use by another application."
      } else if (err.name === "OverconstrainedError" || err.name === "ConstraintNotSatisfiedError") {
        errorMessage = "Camera cannot satisfy the requested constraints."
      } else if (err.name === "NotSupportedError") {
        errorMessage = "Camera access is not supported by this browser."
      } else if (err.name === "TypeError" && err.message.includes("mediaDevices")) {
        errorMessage = "Camera API not available. Try using HTTPS."
      }

      setError(errorMessage)
      setIsActive(false)
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
    captureAndSendTwoFrames(video)
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
      initCamera()
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
      if (audioContextRef.current) {
        audioContextRef.current.close()
      }
    }
  }, [])

  return (
    <div className="flex flex-col gap-6 max-w-3xl mx-auto">
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-md bg-red-100 text-red-700">
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
          <span>{error}</span>
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

        <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={w-full h-full object-cover ${isActive ? "opacity-100" : "opacity-50"}}
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
                <line x1="12" y1="19" x2="12.01" y2="19"></line>
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
          {lastMessage && (
            <>
              <h3 className="font-medium mb-1">Last Guidance:</h3>
              <p>{lastMessage}</p>
            </>
          )}
          {responseTime !== null && (
            <>
              <h3 className="font-medium mb-1">Response Time:</h3>
              <p>{responseTime} seconds</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default NavigationAssistant