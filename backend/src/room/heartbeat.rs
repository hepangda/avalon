//! Transport RTT: timestamp at the writer, match only the outstanding Ping payload.
use std::time::{Duration, Instant};

#[derive(Default)]
pub(super) struct Heartbeat {
    sequence: u64,
    pending: Option<(u64, Instant)>,
}

impl Heartbeat {
    pub fn ping(&mut self, now: Instant) -> Result<Option<[u8; 8]>, ()> {
        if let Some((_, sent)) = self.pending {
            return if now.duration_since(sent) >= Duration::from_secs(30) {
                Err(())
            } else {
                Ok(None)
            };
        }
        self.sequence = self.sequence.wrapping_add(1);
        self.pending = Some((self.sequence, now));
        Ok(Some(self.sequence.to_be_bytes()))
    }

    pub fn pong(&mut self, payload: &[u8], now: Instant) -> Option<i64> {
        let (sequence, sent) = self.pending?;
        if payload != sequence.to_be_bytes() {
            return None;
        }
        self.pending = None;
        Some((now.duration_since(sent).as_secs_f64() * 1000.).round() as i64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_only_current_probe_and_measures_round_trip() {
        let mut heartbeat = Heartbeat::default();
        let start = Instant::now();
        let first = heartbeat.ping(start).unwrap().unwrap();
        assert_eq!(heartbeat.pong(b"", start), None);
        assert_eq!(heartbeat.ping(start + Duration::from_secs(4)), Ok(None));
        assert_eq!(
            heartbeat.pong(&first, start + Duration::from_micros(42500)),
            Some(43)
        );
        assert_eq!(heartbeat.pong(&first, start), None);
        let second = heartbeat
            .ping(start + Duration::from_secs(4))
            .unwrap()
            .unwrap();
        assert_ne!(first, second);
        assert_eq!(heartbeat.pong(&first, start + Duration::from_secs(5)), None);
        assert_eq!(
            heartbeat.pong(&second, start + Duration::from_millis(4080)),
            Some(80)
        );
    }

    #[test]
    fn missing_or_unmatched_pong_times_out() {
        let mut heartbeat = Heartbeat::default();
        let start = Instant::now();
        heartbeat.ping(start).unwrap();
        assert_eq!(heartbeat.pong(b"unsolicited", start), None);
        assert_eq!(heartbeat.ping(start + Duration::from_secs(29)), Ok(None));
        assert_eq!(heartbeat.ping(start + Duration::from_secs(30)), Err(()));
    }
}
