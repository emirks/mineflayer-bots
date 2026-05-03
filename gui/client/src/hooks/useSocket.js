import { useEffect, useRef } from 'react'
import { io } from 'socket.io-client'

// Singleton socket — shared across the entire app.
let _socket = null

export function getSocket() {
  if (!_socket) {
    // When deployed to Vercel, VITE_API_URL points at the local backend.
    const url = import.meta.env.VITE_API_URL ?? '/'
    _socket = io(url, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
    })
    _socket.on('connect', () => console.log('[socket] connected', _socket.id))
    _socket.on('disconnect', () => console.log('[socket] disconnected'))
    _socket.on('connect_error', (e) => console.warn('[socket] connect_error', e.message))
  }
  return _socket
}

/**
 * Subscribe to a socket.io event. Automatically unsubscribes on unmount.
 *
 * @param {string} event
 * @param {Function} handler
 */
export function useSocketEvent(event, handler) {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    const s = getSocket()
    const cb = (...args) => handlerRef.current(...args)
    s.on(event, cb)
    return () => s.off(event, cb)
  }, [event])
}
