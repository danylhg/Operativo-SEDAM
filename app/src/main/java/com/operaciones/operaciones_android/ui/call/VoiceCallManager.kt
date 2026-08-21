package com.operaciones.operaciones_android.ui.call

import android.content.Context
import android.media.AudioManager
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
import org.webrtc.SessionDescription
import org.webrtc.SdpObserver

class VoiceCallManager(
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
        synchronized(VoiceCallManager::class.java) {
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

    fun createOffer() {
        ensurePeer()
        val constraints = audioConstraints()
        peer?.createOffer(object : BasicSdpObserver() {
            override fun onCreateSuccess(description: SessionDescription?) {
                description ?: return
                peer?.setLocalDescription(object : BasicSdpObserver() {
                    override fun onSetSuccess() {
                        onSignal("voice_call_offer", JSONObject().put("sdp", description.description))
                    }
                }, description)
            }
        }, constraints)
    }

    fun acceptOffer(sdp: String) {
        ensurePeer()
        peer?.setRemoteDescription(object : BasicSdpObserver() {
            override fun onSetSuccess() {
                remoteReady()
                peer?.createAnswer(object : BasicSdpObserver() {
                    override fun onCreateSuccess(description: SessionDescription?) {
                        description ?: return
                        peer?.setLocalDescription(object : BasicSdpObserver() {
                            override fun onSetSuccess() {
                                onSignal("voice_call_answer", JSONObject().put("sdp", description.description))
                            }
                        }, description)
                    }
                }, audioConstraints())
            }
        }, SessionDescription(SessionDescription.Type.OFFER, sdp))
    }

    fun acceptAnswer(sdp: String) {
        peer?.setRemoteDescription(object : BasicSdpObserver() {
            override fun onSetSuccess() = remoteReady()
        }, SessionDescription(SessionDescription.Type.ANSWER, sdp))
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

    fun setMuted(muted: Boolean) {
        audioTrack?.setEnabled(!muted)
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
        audioTrack = factory.createAudioTrack("sedam_voice", audioSource)
        val config = PeerConnection.RTCConfiguration(
            listOf(PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer())
        ).apply { sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN }
        peer = factory.createPeerConnection(config, object : PeerConnection.Observer {
            override fun onSignalingChange(state: PeerConnection.SignalingState?) {}
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {
                when (state) {
                    PeerConnection.IceConnectionState.CONNECTED,
                    PeerConnection.IceConnectionState.COMPLETED -> onConnected()
                    PeerConnection.IceConnectionState.FAILED -> onFailed()
                    else -> Unit
                }
            }
            override fun onIceConnectionReceivingChange(receiving: Boolean) {}
            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) {}
            override fun onIceCandidate(candidate: IceCandidate?) {
                candidate ?: return
                onSignal("voice_call_ice", JSONObject().apply {
                    put("sdpMid", candidate.sdpMid)
                    put("sdpMLineIndex", candidate.sdpMLineIndex)
                    put("candidate", candidate.sdp)
                })
            }
            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) {}
            override fun onAddStream(stream: MediaStream?) {}
            override fun onRemoveStream(stream: MediaStream?) {}
            override fun onDataChannel(channel: DataChannel?) {}
            override fun onRenegotiationNeeded() {}
            override fun onAddTrack(receiver: RtpReceiver?, streams: Array<out MediaStream>?) {}
        })
        audioTrack?.let { peer?.addTrack(it, listOf("sedam_voice_stream")) }
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

    private open class BasicSdpObserver : SdpObserver {
        override fun onCreateSuccess(description: SessionDescription?) {}
        override fun onSetSuccess() {}
        override fun onCreateFailure(error: String?) {}
        override fun onSetFailure(error: String?) {}
    }

    companion object {
        private var initialized = false
    }
}
