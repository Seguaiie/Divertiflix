using System.Net;
using Divertiflix.Api.Auth;
using Divertiflix.Api.Support;

namespace Divertiflix.Tests;

/// <summary>Horloge réglable à la main : le verrouillage se vérifie sans attendre.</summary>
public sealed class ManualClock : TimeProvider
{
    private DateTimeOffset _now = new(2026, 1, 1, 12, 0, 0, TimeSpan.Zero);
    public override DateTimeOffset GetUtcNow() => _now;
    public void Advance(TimeSpan by) => _now += by;
}

public class LoginThrottleTests
{
    private const string Email = "root";
    private const string Attacker = "203.0.113.9", Owner = "198.51.100.7";

    private static (LoginThrottle Throttle, ManualClock Clock) New()
    {
        var clock = new ManualClock();
        return (new LoginThrottle(clock), clock);
    }

    [Fact]
    public void Four_failures_do_not_lock_the_fifth_does_for_thirty_seconds()
    {
        var (t, clock) = New();
        for (var i = 0; i < 4; i++) t.Failed(Email, Attacker);
        Assert.Null(t.LockedFor(Email, Attacker));
        t.Failed(Email, Attacker);
        Assert.Equal(TimeSpan.FromSeconds(30), t.LockedFor(Email, Attacker));
        clock.Advance(TimeSpan.FromSeconds(31));
        Assert.Null(t.LockedFor(Email, Attacker));
    }

    [Fact]
    public void Locks_grow_progressively_up_to_five_minutes_and_never_beyond()
    {
        var (t, clock) = New();
        for (var i = 0; i < 5; i++) t.Failed(Email, Attacker);
        var seen = new List<double> { t.LockedFor(Email, Attacker)!.Value.TotalSeconds };
        for (var i = 0; i < 5; i++)
        {
            clock.Advance(t.LockedFor(Email, Attacker)!.Value + TimeSpan.FromSeconds(1));   // l'attaquant retente dès que le verrou tombe
            t.Failed(Email, Attacker);
            seen.Add(t.LockedFor(Email, Attacker)!.Value.TotalSeconds);
        }
        Assert.Equal([30, 60, 120, 240, 300, 300], seen);
    }

    [Fact]
    public void Attempts_refused_during_a_lock_do_not_extend_it()
    {
        var (t, clock) = New();
        for (var i = 0; i < 5; i++) t.Failed(Email, Attacker);
        clock.Advance(TimeSpan.FromSeconds(10));
        t.Failed(Email, Attacker);   // un client obstiné continue d'insister
        t.Failed(Email, Attacker);
        Assert.Equal(TimeSpan.FromSeconds(20), t.LockedFor(Email, Attacker));
    }

    [Fact]
    public void Failures_older_than_the_window_are_forgotten()
    {
        var (t, clock) = New();
        for (var i = 0; i < 4; i++) t.Failed(Email, Attacker);
        clock.Advance(TimeSpan.FromMinutes(16));
        t.Failed(Email, Attacker);   // la première fenêtre est close : un seul échec compte
        Assert.Null(t.LockedFor(Email, Attacker));
    }

    [Fact]
    public void A_persistent_attacker_is_held_to_a_handful_of_guesses_and_never_blocks_the_owner()
    {
        // L'attaquant retente à chaque seconde pendant 4 h, dès que le verrou le permet. Les verrous (30 s à 5 min) sont courts,
        // mais le propriétaire, dont la source est connue, n'est jamais bloqué : on ne peut pas l'enfermer dehors durablement.
        var (t, clock) = New();
        t.Succeeded(Email, Owner);
        int guesses = 0, ownerBlocked = 0;
        for (var second = 0; second < 4 * 3600; second++)
        {
            if (t.LockedFor(Email, Attacker) is null) { t.Failed(Email, Attacker); guesses++; }
            if (t.LockedFor(Email, Owner) is not null) ownerBlocked++;
            clock.Advance(TimeSpan.FromSeconds(1));
        }
        Assert.Equal(0, ownerBlocked);
        Assert.InRange(guesses, 1, 200);   // quelques dizaines d'essais en 4 h, au lieu de 14 400
    }

    [Fact]
    public void A_known_source_is_never_locked_but_an_unknown_one_is_and_success_lifts_the_lock()
    {
        var (t, _) = New();
        for (var i = 0; i < 5; i++) t.Failed(Email, Attacker);
        Assert.NotNull(t.LockedFor(Email, Attacker));
        Assert.NotNull(t.LockedFor(Email, Owner));   // pas encore connue : verrouillée comme les autres

        t.Succeeded(Email, Owner);                   // le propriétaire se connecte (mot de passe correct) : verrou levé
        Assert.Null(t.LockedFor(Email, Owner));
        Assert.Null(t.LockedFor(Email, Attacker));

        for (var i = 0; i < 5; i++) t.Failed(Email, Attacker);
        Assert.NotNull(t.LockedFor(Email, Attacker));
        Assert.Null(t.LockedFor(Email, Owner));      // connue : jamais bloquée par les échecs des autres
    }

    [Fact]
    public void Emails_are_independent_and_only_the_eight_latest_sources_stay_known()
    {
        var (t, _) = New();
        for (var i = 0; i < 5; i++) t.Failed("autre", Attacker);
        Assert.Null(t.LockedFor(Email, Attacker));
        for (var i = 0; i < 9; i++) t.Succeeded(Email, $"10.0.0.{i}");
        for (var i = 0; i < 5; i++) t.Failed(Email, Attacker);
        Assert.NotNull(t.LockedFor(Email, "10.0.0.0"));   // la plus ancienne a été oubliée
        Assert.Null(t.LockedFor(Email, "10.0.0.8"));
    }
}

public class ClientAddressTests
{
    private static string Key(string ip) => ClientAddress.Key(IPAddress.Parse(ip));

    [Fact]
    public void Ipv6_addresses_of_the_same_64_share_one_key_and_other_prefixes_do_not()
    {
        Assert.Equal(Key("2001:db8:abcd:12::2"), Key("2001:db8:abcd:12::61"));
        Assert.Equal(Key("2001:db8:abcd:12::2"), Key("2001:db8:abcd:12:ffff:ffff:ffff:ffff"));
        Assert.NotEqual(Key("2001:db8:abcd:12::2"), Key("2001:db8:abcd:13::2"));
        Assert.EndsWith("/64", Key("2001:db8:abcd:12::2"));
    }

    [Fact]
    public void Ipv4_is_untouched_and_a_mapped_ipv4_is_the_same_client()
    {
        Assert.Equal("203.0.113.9", Key("203.0.113.9"));
        Assert.Equal("203.0.113.9", Key("::ffff:203.0.113.9"));
        Assert.NotEqual(Key("203.0.113.9"), Key("203.0.113.10"));
        Assert.Equal("unknown", ClientAddress.Key(null));
    }
}

public class SafeUrlTests
{
    [Theory]
    [InlineData(null, true)]
    [InlineData("", true)]
    [InlineData("   ", true)]
    [InlineData("http://example.org/a.mp4", true)]
    [InlineData("https://example.org/a/index.m3u8?x=1#t", true)]
    [InlineData("media:demo/index.m3u8", true)]
    [InlineData("media:", false)]
    [InlineData("Media:demo/x", false)]
    [InlineData("javascript:alert(1)", false)]
    [InlineData("https://", false)]
    [InlineData("/api/media/art/x.webp", false)]
    [InlineData("//example.org/x", false)]
    public void Stream_sources_follow_the_allow_list(string? url, bool allowed) => Assert.Equal(allowed, SafeUrl.IsAllowed(url));

    [Theory]
    [InlineData("/api/media/art/x/poster.webp", true)]
    [InlineData("/", true)]
    [InlineData("//example.org/x", false)]
    [InlineData("/\\example.org", false)]
    [InlineData("javascript:alert(1)", false)]
    [InlineData("https://example.org/p.webp", true)]
    public void Images_may_also_use_a_site_path(string url, bool allowed) => Assert.Equal(allowed, SafeUrl.IsAllowed(url, sitePath: true));
}

public class PasswordPolicyTests
{
    [Theory]
    [InlineData("Passw0rd!", "a@test.com")]
    [InlineData("Passw0rd!e2e", "a@test.com")]
    [InlineData("q7Xk!m2P", "a@test.com")]
    [InlineData("boom123$", "root")]
    public void Ordinary_passwords_pass(string password, string email) => Assert.Null(PasswordPolicy.Reject(password, email));

    [Theory]
    [InlineData("password", "a@test.com")]
    [InlineData("Password123", "a@test.com")]
    [InlineData("QWERTYUIOP", "a@test.com")]
    [InlineData("zzzzzzzz", "a@test.com")]
    [InlineData("marie.curie@test.com", "marie.curie@test.com")]
    [InlineData("Marie.Curie", "marie.curie@test.com")]
    public void Guessable_passwords_are_refused(string password, string email) => Assert.NotNull(PasswordPolicy.Reject(password, email));
}
