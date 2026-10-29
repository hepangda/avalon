/// Minimize repeated seats, then sample uniformly among optimal permutations.
pub fn order(previous: &[Option<usize>], seed: &str) -> Vec<usize> {
    let n = previous.len();
    let full = (1usize << n) - 1;
    let mut cost = vec![usize::MAX; full + 1];
    let mut ways = vec![0u64; full + 1];
    cost[full] = 0;
    ways[full] = 1;
    for mask in (0..full).rev() {
        let seat = mask.count_ones() as usize;
        for (i, previous_seat) in previous.iter().enumerate() {
            if mask & (1 << i) != 0 {
                continue;
            }
            let next = mask | (1 << i);
            let c = cost[next] + usize::from(*previous_seat == Some(seat));
            if c < cost[mask] {
                cost[mask] = c;
                ways[mask] = ways[next];
            } else if c == cost[mask] {
                ways[mask] += ways[next];
            }
        }
    }
    let mut rng = crate::engine::Rng::new(seed);
    let mut mask = 0;
    let mut result = Vec::with_capacity(n);
    for seat in 0..n {
        let mut ticket = (rng.next() * ways[mask] as f64).floor() as u64;
        for (i, previous_seat) in previous.iter().enumerate() {
            if mask & (1 << i) != 0 {
                continue;
            }
            let next = mask | (1 << i);
            if cost[next] + usize::from(*previous_seat == Some(seat)) != cost[mask] {
                continue;
            }
            if ticket < ways[next] {
                result.push(i);
                mask = next;
                break;
            }
            ticket -= ways[next];
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn deranges_and_preserves_all_seats() {
        for n in 5..=10 {
            let p = (0..n).map(Some).collect::<Vec<_>>();
            let result = order(&p, "seats");
            assert!(result.iter().enumerate().all(|(seat, p)| seat != *p));
            let mut all = result.clone();
            all.sort();
            assert_eq!(all, (0..n).collect::<Vec<_>>());
            assert_eq!(result, order(&p, "seats"));
        }
    }
}
