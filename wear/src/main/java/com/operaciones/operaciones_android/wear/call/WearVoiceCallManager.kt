package com.operaciones.operaciones_android.wear.call

import android.content.Context
import android.media.AudioManager
import android.util.Log
import org.json.JSONObject
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.DataChannel
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription

class WearVoiceCallManager(
    context: Context,
    private val onSignal: (String, JSONObject) -> Unit,
    private val onConnected: () -> Unit,
    private val onFailed: () -> Unit
) {
    private val appContext = context.applicationContext
    private val audioManager = appContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val factory: PeerConnectionFactory
    private var peer: PeerConnection? = null
    private var audioSource: AudioSource? = null
    private var audioTrack: AudioTrack? = null
    private val pendingIce = mutableListOf<IceCandidate>()
    private var remoteDescriptionSet = false
    private var previousAudioMode = AudioManager.MODE_NORMAL
    private var previousSpeaker = false

    init {
        synchronized(WearVoiceCallManager::class.java) {
            if (!initialized) {
                PeerConnectionFactory.initialize(
                    PeerConnectionFactory.InitializationOptions.builder(appContext)
                        .createInitializationOptions()
                )
                initialized = true
            }
        }
        factory = PeerConnectionFactory.builder().createPeerConnectionFactory()
    }

    fun acceptOffer(sdp: String) {
        if (sdp.isBlank()) {
            onFailed()
            return
        }
        ensurePeer()
        peer?.setRemoteDescription(object : BasicSdpObserver() {
            override fun onSetSuccess() {
                remoteReady()
                peer?.createAnswer(object : BasicSdpObserver() {
                    override fun onCreateSuccess(description: SessionDescription?) {
                        description ?: return onFailed()
                        peer?.setLocalDescription(object : BasicSdpObserver() {
                            override fun onSetSuccess() {
                                onSignal("voice_call_answer", JSONObject().put("sdp", description.description))
                            }

                            override fun onSetFailure(error: String?) = fail("local answer", error)
                        }, description)
                    }

                    override fun onCreateFailure(error: String?) = fail("answer", error)
                }, audioConstraints())
            }

            override fun onSetFailure(error: String?) = fail("remote offer", error)
        }, SessionDescription(SessionDescription.Type.OFFER, sdp))
    }

    fun addIce(data: JSONObject) {
        val candidate = IceCandidate(
            data.optString("sdpMid", ""),
            data.optInt("sdpMLineIndex", 0),
            data.optString("candidate", "")
        )
        if (candidate.sdp.isBlank()) return
        if (remoteDescriptionSet) peer?.addIceCandidate(candidate) else pendingIce.add(candidate)
    }

    fun close() {
        peer?.close()
        peer?.dispose()
        peer = null
        audioTrack?.dispose()
        audioTrack = null
        audioSource?.dispose()
        audioSource = null
        factory.dispose()
        pendingIce.clear()
        remoteDescriptionSet = false
        audioManager.mode = previousAudioMode
        audioManager.isSpeakerphoneOn = previousSpeaker
    }

    private fun ensurePeer() {
        if (peer != null) return
        previousAudioMode = audioManager.mode
        previousSpeaker = audioManager.isSpeakerphoneOn
        audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
        audioManager.isSpeakerphoneOn = true

        audioSource = factory.createAudioSource(MediaConstraints())
        audioTrack = factory.createAudioTrack("sedam_wear_voice", audioSource)
        val config = PeerConnection.RTCConfiguration(
            listOf(PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer())
        ).apply { sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN }

        peer = factory.createPeerConnection(config, object : PeerConnection.Observer {
            override fun onSignalingChange(state: PeerConnection.SignalingState?) = Unit
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {
                when (state) {
                    PeerConnection.IceConnectionState.CONNECTED,
                    PeerConnection.IceConnectionState.COMPLETED -> onConnected()
                    PeerConnection.IceConnectionState.FAILED -> onFailed()
                    else -> Unit
                }
            }
            override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) = Unit
            override fun onIceCandidate(candidate: IceCandidate?) {
                candidate ?: return
                onSignal("voice_call_ice", JSONObject().apply {
                    put("sdpMid", candidate.sdpMid)
                    put("sdpMLineIndex", candidate.sdpMLineIndex)
                    put("candidate", candidate.sdp)
                })
            }
            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) = Unit
            override fun onAddStream(stream: MediaStream?) = Unit
            override fun onRemoveStream(stream: MediaStream?) = Unit
            override fun onDataChannel(channel: DataChannel?) = Unit
            override fun onRenegotiationNeeded() = Unit
            override fun onAddTrack(receiver: RtpReceiver?, streams: Array<out MediaStream>?) = Unit
        })
        audioTrack?.let { peer?.addTrack(it, listOf("sedam_wear_voice_stream")) }
    }

    private fun remoteReady() {
        remoteDescriptionSet = true
        pendingIce.forEach { peer?.addIceCandidate(it) }
        pendingIce.clear()
    }

    private fun audioConstraints() = MediaConstraints().apply {
        mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"))
        mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", "false"))
    }

    private fun fail(stage: String, error: String?) {
        Log.e(TAG, "WebRTC $stage: ${error.orEmpty()}")
        onFailed()
    }

    private open class BasicSdpObserver : SdpObserver {
        override fun onCreateSuccess(description: SessionDescription?) = Unit
        override fun onSetSuccess() = Unit
        override fun onCreateFailure(error: String?) = Unit
        override fun onSetFailure(error: String?) = Unit
    }

    companion object {
        private const val TAG = "WearVoiceCall"
        private var initialized = false
    }
}
