//! Offline cutover utility. No flags means read-only review; --apply is explicit.
use anyhow::{Result, bail};
#[tokio::main]
async fn main() -> Result<()> {
    let _ = dotenvy::dotenv();
    let apply = parse_mode(std::env::args().skip(1))?;
    let Some(apply) = apply else {
        return Ok(());
    };
    let url =
        std::env::var("DATABASE_URL").map_err(|_| anyhow::anyhow!("DATABASE_URL is required"))?;
    let report = avalon_server::migration::run(&url, apply).await?;
    println!("{}", serde_json::to_string_pretty(&report)?);
    Ok(())
}
fn parse_mode(args: impl IntoIterator<Item = String>) -> Result<Option<bool>> {
    let mut mode = None;
    for arg in args {
        match arg.as_str() {
            "--apply" | "--dry-run" => {
                if mode.is_some() {
                    bail!("Specify only one mode: --dry-run or --apply");
                }
                mode = Some(arg == "--apply");
            }
            "--help" | "-h" => {
                println!(
                    "migrate-randomness [--dry-run | --apply]\n\nUses DATABASE_URL. Default is a read-only plan. Stop all Avalon servers first.\n--apply atomically archives and ends old rooms, converts completed replays, and marks the one-way Rust cutover.\nAccount, card, reward, preference and role-weight records are preserved. Existing login sessions expire at the Rust cutover."
                );
                return Ok(None);
            }
            _ => bail!("Unknown argument {arg}; use --help"),
        }
    }
    Ok(Some(mode.unwrap_or(false)))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn flags_cannot_accidentally_upgrade_a_dry_run() {
        assert_eq!(parse_mode(Vec::<String>::new()).unwrap(), Some(false));
        assert_eq!(parse_mode(["--dry-run".into()]).unwrap(), Some(false));
        assert_eq!(parse_mode(["--apply".into()]).unwrap(), Some(true));
        for args in [
            ["--dry-run", "--apply"],
            ["--apply", "--dry-run"],
            ["--apply", "--apply"],
        ] {
            assert!(parse_mode(args.map(String::from)).is_err());
        }
    }
}
