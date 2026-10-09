package com.operaciones.operaciones_android.ui.media

import com.operaciones.operaciones_android.config.ApiConfig
import org.json.JSONObject

/**
 * Página HTML mínima para ver en un WebView la transmisión WebRTC de otro
 * operador. Replica el flujo de viewer de stream_viewer.html del dashboard:
 * stream_join por socket, oferta del publicador, respuesta e ICE.
 */
object WebRtcViewerHtml {
    fun build(operationId: Int, idStream: Int, token: String, fit: String = "cover"): String {
        val base = JSONObject.quote(ApiConfig.BASE_URL.trimEnd('/'))
        val jsToken = JSONObject.quote(token)
        val jsFit = JSONObject.quote(fit)
        val socketScript = ApiConfig.BASE_URL.trimEnd('/') + "/socket.io/socket.io.js"
        return """
            <!DOCTYPE html>
            <html>
            <head>
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body, html { margin:0; padding:0; background:#060C17; color:#F1F5F9; font-family:sans-serif; width:100%; height:100%; overflow:hidden; }
                    video { position:absolute; inset:0; width:100%; height:100%; background:#000; display:none; }
                    #status { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; text-align:center; padding:12px; }
                    .badge { background:rgba(0,229,240,0.15); border:1px solid #00E5F0; color:#00E5F0; font-size:11px; font-weight:bold; padding:5px 12px; border-radius:16px; }
                </style>
                <script src="$socketScript"></script>
            </head>
            <body>
                <div id="status"><div class="badge" id="msg">Conectando video...</div></div>
                <video id="v" playsinline muted autoplay></video>
                <script>
                    var BASE = $base, TOKEN = $jsToken, OP = $operationId, ID = $idStream;
                    var video = document.getElementById('v');
                    video.style.objectFit = $jsFit;
                    var msg = document.getElementById('msg');
                    var statusBox = document.getElementById('status');
                    var pc = null, publisher = '', pending = [], ice = [{ urls: 'stun:stun.l.google.com:19302' }], sock = null;

                    function say(text) { statusBox.style.display = 'flex'; video.style.display = 'none'; msg.textContent = text; }
                    function showVideo() { statusBox.style.display = 'none'; video.style.display = 'block'; video.play().catch(function () {}); }

                    function makePc() {
                        var stream = new MediaStream();
                        video.srcObject = stream;
                        var p = new RTCPeerConnection({ iceServers: ice });
                        p.ontrack = function (e) {
                            if (e.streams && e.streams[0]) {
                                e.streams[0].getTracks().forEach(function (t) {
                                    if (!stream.getTracks().some(function (c) { return c.id === t.id; })) stream.addTrack(t);
                                });
                            } else { stream.addTrack(e.track); }
                            showVideo();
                        };
                        p.onicecandidate = function (e) {
                            if (!e.candidate || !publisher || !sock) return;
                            sock.emit('webrtc_ice_candidate', { id_operacion: OP, id_stream: ID, to: publisher, candidate: e.candidate.toJSON() });
                        };
                        p.onconnectionstatechange = function () {
                            if (p.connectionState === 'disconnected') say('Reconectando video...');
                            if (p.connectionState === 'failed' || p.connectionState === 'closed') say('Sin señal de video');
                        };
                        return p;
                    }

                    function start() {
                        sock = io(BASE, { transports: ['websocket', 'polling'] });
                        sock.on('connect', function () {
                            sock.emit('join_operacion', { id_operacion: OP });
                            sock.emit('stream_join', { id_operacion: OP, id_stream: ID, role: 'viewer' }, function (ack) {
                                if (!ack || !ack.ok) say('No se pudo unir a la transmisión');
                                else say('Esperando video...');
                            });
                        });
                        sock.on('connect_error', function () { say('Sin conexión con el servidor'); });
                        sock.on('media_stream_waiting_for_publisher', function () { say('Esperando señal...'); });
                        sock.on('media_stream_stopped', function (p) {
                            if (p && p.id_stream && Number(p.id_stream) !== ID) return;
                            say('Transmisión detenida');
                        });
                        sock.on('webrtc_offer', async function (p) {
                            if (Number(p.id_stream) !== ID) return;
                            publisher = p.from_socket_id || p.from || '';
                            if (pc) { pc.close(); pc = null; }
                            pc = makePc();
                            await pc.setRemoteDescription({ type: p.type || 'offer', sdp: p.sdp });
                            var answer = await pc.createAnswer();
                            await pc.setLocalDescription(answer);
                            sock.emit('webrtc_answer', { id_operacion: OP, id_stream: ID, to: publisher, type: answer.type, sdp: answer.sdp });
                            for (var i = 0; i < pending.length; i++) { await pc.addIceCandidate(pending[i]); }
                            pending = [];
                        });
                        sock.on('webrtc_ice_candidate', async function (p) {
                            if (Number(p.id_stream) !== ID) return;
                            var raw = p.candidate || p;
                            if (!raw || !raw.candidate) return;
                            var cand = new RTCIceCandidate(raw);
                            if (!pc || !pc.remoteDescription) { pending.push(cand); return; }
                            await pc.addIceCandidate(cand);
                        });
                    }

                    fetch(BASE + '/ops/' + OP + '/streams/webrtc-config', { headers: { Authorization: 'Bearer ' + TOKEN } })
                        .then(function (r) { return r.json(); })
                        .then(function (j) {
                            if (j && j.config && j.config.iceServers && j.config.iceServers.length) ice = j.config.iceServers;
                        })
                        .catch(function () {})
                        .then(start);
                </script>
            </body>
            </html>
        """.trimIndent()
    }
}
