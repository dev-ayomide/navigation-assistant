from flask import Flask, request, jsonify
from flask_socketio import SocketIO, emit

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")  # Allow CORS for frontend access

@app.route("/")
def index():
    return jsonify({"message":"hello from Fadexadex"})

@socketio.on("connect")
def handle_connect():
    print("Client connected")

@socketio.on("disconnect")
def handle_disconnect():
    print("Client disconnected")

@socketio.on("send_frames_batch")
def handle_message(data):
    main_stuff = data.get("frames", [])
    print(f"Received {len(main_stuff)} frames")
    for frame in main_stuff:
        print("Hello world")
        
        print(frame)
    # Echo back a response for testing
    emit("server_response", {"message": f"Received {len(main_stuff)} frames for processing"})

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)