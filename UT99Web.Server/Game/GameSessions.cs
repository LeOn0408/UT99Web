using System.Collections.Concurrent;

namespace UT99Web.Server.Game;

public sealed class GameSession
{
    public required string Id { get; init; }
    public int Health { get; set; } = 100;
    public int Armor { get; set; }
    public int Frags { get; set; }
    public int Deaths { get; set; }
    public bool Dead => Health <= 0;
    public ConcurrentDictionary<string, int> Bots { get; } = new(StringComparer.OrdinalIgnoreCase);
}

public sealed class GameSessionService
{
    private static readonly Dictionary<string, int> WeaponDamage = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Enforcer"] = 17,
        ["ShockRifle"] = 40,
        ["SniperRifle"] = 45,
        ["UT_FlakCannon"] = 35,
        ["PulseGun"] = 18,
        ["UT_Eightball"] = 80,
        ["minigun2"] = 8,
        ["ripper"] = 30,
        ["ut_biorifle"] = 20,
        ["WarheadLauncher"] = 80,
        ["EnforcerAlt"] = 17,
        ["ShockRifleAlt"] = 55,
        ["SniperRifleAlt"] = 45,
        ["UT_FlakCannonAlt"] = 20,
        ["PulseGunAlt"] = 18,
        ["UT_EightballAlt"] = 60,
        ["minigun2Alt"] = 8,
        ["ripperAlt"] = 30,
        ["ut_biorifleAlt"] = 75,
        ["WarheadLauncherAlt"] = 80
    };

    private readonly ConcurrentDictionary<string, GameSession> sessions = new(StringComparer.OrdinalIgnoreCase);

    public GameSession Create(int botCount)
    {
        var session = new GameSession { Id = Guid.NewGuid().ToString("N") };
        for (var index = 0; index < botCount; index++)
        {
            session.Bots[$"bot{index}"] = 100;
        }
        sessions[session.Id] = session;
        return session;
    }

    public GameSession? Get(string id) => sessions.GetValueOrDefault(id);

    public DamageResult? Damage(string id, string target, int amount, string source)
    {
        if (!sessions.TryGetValue(id, out var session)) return null;
        amount = Math.Clamp(amount, 0, 1000);
        source = string.IsNullOrWhiteSpace(source) ? "unknown" : source[..Math.Min(source.Length, 64)];

        if (string.Equals(target, "player", StringComparison.OrdinalIgnoreCase))
        {
            if (session.Dead) return new DamageResult(session.Health, session.Armor, true, false, session.Deaths);
            var absorbed = Math.Min(session.Armor, (int)MathF.Round(amount * 0.5f));
            session.Armor -= absorbed;
            session.Health = Math.Max(0, session.Health - (amount - absorbed));
            var killed = session.Health == 0;
            if (killed) session.Deaths += 1;
            return new DamageResult(session.Health, session.Armor, killed, false, session.Deaths);
        }

        if (!session.Bots.TryGetValue(target, out var health)) return null;
        if (health <= 0) return new DamageResult(0, 0, true, true, session.Frags);
        var newHealth = Math.Max(0, health - amount);
        session.Bots[target] = newHealth;
        var botKilled = newHealth == 0;
        if (botKilled) session.Frags += 1;
        return new DamageResult(newHealth, 0, botKilled, true, session.Frags);
    }

    public DamageResult? WeaponHit(string id, string weapon, string target)
    {
        if (!WeaponDamage.TryGetValue(weapon, out var damage)) return null;
        return Damage(id, target, damage, weapon);
    }

    public DamageResult? BotHit(string id, string bot)
    {
        if (!sessions.TryGetValue(id, out var session)) return null;
        if (!session.Bots.ContainsKey(bot)) return null;
        if (Random.Shared.NextDouble() >= 0.4)
        {
            return new DamageResult(session.Health, session.Armor, false, false, session.Frags);
        }
        var damage = Random.Shared.Next(7, 19);
        return Damage(id, "player", damage, bot);
    }

    public GameSession? Respawn(string id)
    {
        if (!sessions.TryGetValue(id, out var session)) return null;
        session.Health = 100;
        session.Armor = 0;
        return session;
    }

    public GameSession? RespawnBot(string id, string target)
    {
        if (!sessions.TryGetValue(id, out var session)) return null;
        if (!session.Bots.ContainsKey(target)) return null;
        session.Bots[target] = 100;
        return session;
    }
}

public sealed record DamageResult(int Health, int Armor, bool Killed, bool TargetIsBot, int Score);

public sealed record WeaponHitRequest(string Weapon, string Target);

public sealed record BotHitRequest(string Bot);

public sealed record DamageRequest(string Target, int Amount, string? Source);

public sealed record CreateSessionRequest(int BotCount);
