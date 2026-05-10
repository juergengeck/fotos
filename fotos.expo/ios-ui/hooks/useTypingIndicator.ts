import { useState, useEffect, useCallback, useRef } from 'react'
import { useModel } from './ModelContext'
import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js'
import type { Person } from '@refinio/one.core/lib/recipes.js'
import type { Topic } from '@refinio/one.models/lib/recipes/ChatRecipes.js'

interface ComposingUser {
  personId: string
  name: string
  since: number
}

interface UseTypingIndicatorReturn {
  /** Users currently composing in this topic */
  composingUsers: ComposingUser[]
  /** Set local user's composing state (debounced) */
  setLocalComposing: (isComposing: boolean) => void
}

// Stale timeout - clear composing state after 5 seconds of no refresh
const STALE_TIMEOUT_MS = 5000

// Debounce for local composing - don't spam updates
const DEBOUNCE_MS = 300

/**
 * Hook to track typing indicators for a topic.
 *
 * Listens for composing state changes from other users via Topic version updates
 * and provides a debounced function to update local composing state.
 *
 * iOS version uses direct TopicModel access instead of IPC.
 *
 * @param topicId - The topic to track composing for
 * @returns composingUsers array and setLocalComposing function
 */
export function useTypingIndicator(topicId: string): UseTypingIndicatorReturn {
  const model = useModel()

  // Map of personId -> { name, since }
  const [composingMap, setComposingMap] = useState<Map<string, { name: string; since: number }>>(new Map())

  // Refs for cleanup
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const staleTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const lastLocalComposingRef = useRef<boolean>(false)
  const previousComposingRef = useRef<Map<string, number>>(new Map())
  const unsubscribeRef = useRef<(() => void) | null>(null)

  // Subscribe to Topic version updates
  useEffect(() => {
    let mounted = true

    const setupSubscription = async () => {
      try {
        const { objectEvents } = await import('@refinio/one.models/lib/misc/ObjectEventDispatcher.js')

        unsubscribeRef.current = objectEvents.onNewVersion(
          async (result: { obj: any; idHash: string }) => {
            if (!mounted) return
            if (result.obj.$type$ !== 'Topic') return
            if (result.idHash !== topicId) return

            const topic = result.obj
            const newComposing: Map<string, number> = topic.composing ?? new Map()
            const prevComposing = previousComposingRef.current

            // Detect changes
            const changes: Array<{ personId: string; isComposing: boolean; timestamp?: number }> = []

            // Who started composing
            for (const [personId, timestamp] of newComposing) {
              if (!prevComposing.has(personId)) {
                changes.push({ personId, isComposing: true, timestamp })
              }
            }

            // Who stopped composing
            for (const [personId] of prevComposing) {
              if (!newComposing.has(personId)) {
                changes.push({ personId, isComposing: false })
              }
            }

            // Update previous state
            previousComposingRef.current = new Map(newComposing)

            // Process changes
            for (const change of changes) {
              if (!mounted) return

              setComposingMap(prev => {
                const next = new Map(prev)

                if (change.isComposing) {
                  // Add or update composing user
                  next.set(change.personId, {
                    name: change.personId.substring(0, 8), // TODO: resolve person name
                    since: change.timestamp || Date.now()
                  })

                  // Set stale timeout to auto-remove if no refresh
                  const existingTimer = staleTimersRef.current.get(change.personId)
                  if (existingTimer) {
                    clearTimeout(existingTimer)
                  }
                  const timer = setTimeout(() => {
                    setComposingMap(current => {
                      const updated = new Map(current)
                      updated.delete(change.personId)
                      return updated
                    })
                    staleTimersRef.current.delete(change.personId)
                  }, STALE_TIMEOUT_MS)
                  staleTimersRef.current.set(change.personId, timer)
                } else {
                  // Remove composing user
                  next.delete(change.personId)

                  // Clear stale timer
                  const existingTimer = staleTimersRef.current.get(change.personId)
                  if (existingTimer) {
                    clearTimeout(existingTimer)
                    staleTimersRef.current.delete(change.personId)
                  }
                }

                return next
              })
            }
          },
          'useTypingIndicator: composing changes',
          'Topic'
        )
      } catch (error) {
        console.error('[useTypingIndicator] Failed to set up subscription:', error)
      }
    }

    setupSubscription()

    return () => {
      mounted = false

      // Unsubscribe from objectEvents
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }

      // Cleanup stale timers
      for (const timer of staleTimersRef.current.values()) {
        clearTimeout(timer)
      }
      staleTimersRef.current.clear()
    }
  }, [topicId])

  // Clear composing state when topic changes
  useEffect(() => {
    setComposingMap(new Map())
    lastLocalComposingRef.current = false
    previousComposingRef.current = new Map()

    // Clear any pending debounce
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
  }, [topicId])

  // Set local composing state (debounced)
  const setLocalComposing = useCallback(async (isComposing: boolean) => {
    // Skip if state hasn't changed
    if (lastLocalComposingRef.current === isComposing) return

    // Clear existing debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    // Debounce the call
    debounceTimerRef.current = setTimeout(async () => {
      try {
        if (!model.topicModel) {
          console.warn('[useTypingIndicator] TopicModel not available')
          return
        }

        const myId = await model.leuteModel.myMainIdentity()
        if (!myId) {
          console.warn('[useTypingIndicator] No main identity')
          return
        }

        lastLocalComposingRef.current = isComposing
        await model.topicModel.setComposing(
          topicId as SHA256IdHash<Topic>,
          myId as SHA256IdHash<Person>,
          isComposing
        )
      } catch (error) {
        console.error('[useTypingIndicator] Failed to set composing state:', error)
      }
    }, isComposing ? DEBOUNCE_MS : 0) // Immediate for stop, debounced for start
  }, [topicId, model])

  // Cleanup on unmount - send stop composing
  useEffect(() => {
    return () => {
      if (lastLocalComposingRef.current && model.topicModel && model.leuteModel) {
        model.leuteModel.myMainIdentity()
          .then((myId: SHA256IdHash<Person> | undefined) => {
            if (myId) {
              return model.topicModel.setComposing(
                topicId as SHA256IdHash<Topic>,
                myId as SHA256IdHash<Person>,
                false
              )
            }
          })
          .catch(() => {}) // Ignore errors on unmount
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [topicId, model])

  // Convert map to array
  const composingUsers: ComposingUser[] = Array.from(composingMap.entries()).map(([personId, data]) => ({
    personId,
    name: data.name,
    since: data.since
  }))

  return { composingUsers, setLocalComposing }
}
