# MetaKing Unity Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Unity 6 LTS iOS game client — island map, player movement, combat, portal system, HUD, onboarding, and server integration.

**Architecture:** Single Unity scene per major state (Bootstrap, Onboarding, Game). All gameplay is local. Server calls happen via a singleton `ApiClient` at discrete moments: session start, portal entry, session end, leaderboard fetch. Game constants fetched from server on session start and cached in `GameConstants.cs`.

**Tech Stack:** Unity 6 LTS, C#, Universal Render Pipeline (URP), Unity Input System, RevenueCat Unity SDK, Sign in with Apple Unity plugin.

---

## File Structure

```
Assets/
├── Scripts/
│   ├── Config/
│   │   └── GameConstants.cs          # Mirrors server constants, populated at runtime
│   ├── Api/
│   │   ├── ApiClient.cs              # All HTTP calls to server
│   │   ├── Models.cs                 # Response/request DTOs
│   │   └── AuthManager.cs            # Sign in with Apple + JWT storage
│   ├── Player/
│   │   ├── PlayerController.cs       # Movement, dodge roll, input
│   │   ├── PlayerVitals.cs           # Mana, stamina, hearts state + events
│   │   ├── PlayerCombat.cs           # Auto-attack logic
│   │   └── PlayerWeapon.cs           # Weapon swap, attack range/speed
│   ├── Warlocks/
│   │   ├── WarlockAI.cs              # Patrol + chase FSM
│   │   ├── WarlockGroup.cs           # Group management
│   │   └── WarlockSpawnManager.cs    # Off-screen respawn, density maintenance
│   ├── Portals/
│   │   ├── Portal.cs                 # Portal behaviour, nameplate
│   │   └── PortalManager.cs          # 3 portals active, replacement on use
│   ├── Pickups/
│   │   └── HeartPickup.cs            # Collect + respawn timer
│   ├── Map/
│   │   ├── MapBounds.cs              # Island boundary enforcement
│   │   └── MinimapController.cs      # Minimap render texture + blips
│   ├── UI/
│   │   ├── HUD.cs                    # Mana, stamina, hearts, weapon icon
│   │   ├── LeaderboardPanel.cs       # Top 10 display
│   │   ├── PortalConfirmPanel.cs     # Confirm visit + emoji picker
│   │   ├── SessionSummaryPanel.cs    # On-open summary of offline losses
│   │   ├── OnboardingFlow.cs         # 4-5 screen onboarding
│   │   ├── NicknamePanel.cs          # Nickname entry + validation
│   │   └── PaywallPanel.cs           # RevenueCat paywall
│   ├── Subscriptions/
│   │   └── SubscriptionManager.cs    # RevenueCat SDK wrapper
│   ├── Game/
│   │   ├── GameManager.cs            # Session lifecycle, scene flow
│   │   └── DeathRespawn.cs           # Death handling, respawn logic
│   └── Utils/
│       └── CoroutineHelper.cs        # Static coroutine runner
├── Scenes/
│   ├── Bootstrap.unity               # Auth check, loads Onboarding or Game
│   ├── Onboarding.unity              # Nickname + subscription flow
│   └── Game.unity                    # Main gameplay scene
├── Materials/
│   ├── IslandTerrain.mat             # Low-poly cel-shaded terrain
│   ├── GrassSway.mat                 # Animated grass shader
│   ├── PortalGlow.mat                # Portal particle material
│   └── WarlockOutline.mat            # Cel-shaded warlock
├── Prefabs/
│   ├── Player.prefab
│   ├── Warlock.prefab
│   ├── Portal.prefab
│   └── HeartPickup.prefab
└── Tests/
    ├── EditMode/
    │   ├── PlayerVitalsTests.cs
    │   ├── WeaponTierTests.cs
    │   └── GameConstantsTests.cs
    └── PlayMode/
        ├── PlayerMovementTests.cs
        └── WarlockAITests.cs
```

---

## Task 1: Unity project setup & URP configuration

**Files:**
- Create: Unity 6 LTS project at `client/`
- Configure: URP pipeline asset
- Create: `Assets/Scripts/Config/GameConstants.cs`

- [ ] **Step 1: Create Unity project**

In Unity Hub: New Project → Unity 6 LTS → **3D (URP)** template → name `MetaKingClient` → location `metaking/client/`.

- [ ] **Step 2: Configure URP for mobile performance**

Open `Assets/Settings/UniversalRenderPipelineAsset.asset`:
- Rendering Path: Forward+
- HDR: Off (mobile battery)
- MSAA: 2x
- Shadow Distance: 80
- Post Processing: On (vignette, color grading LUT)

- [ ] **Step 3: Create `Assets/Scripts/Config/GameConstants.cs`**

```csharp
using UnityEngine;

[System.Serializable]
public class GameConstantsData
{
    public int manaMin = 100;
    public int staminaMin = 10;
    public int staminaStart = 10;
    public int heartsMax = 20;
    public int heartsStart = 20;
    public int heartPickupRestore = 5;
    public int heartPickupRespawnSeconds = 60;
    public int heartPickupsOnMap = 8;
    public int portalCount = 3;
    public int portalManaGain = 10;
    public int portalStaminaCost = 40;
    public int portalStaminaRequired = 50;
    public int portalManaSteal = 10;
    public int warlockHitHearts = 1;
    public int warlockHitStamina = 1;
    public int warlockKillStamina = 5;
    public int warlockGroupsMin = 12;
    public int warlockGroupsMax = 16;
    public int warlockGroupSizeMin = 3;
    public int warlockGroupSizeMax = 6;
    public float warlockChaseRadius = 8f;
    public int deathManaPenalty = 50;
    public int deathStaminaReset = 10;
    public int deathHeartsReset = 20;
    public int mapSize = 500;
}

public static class GameConstants
{
    public static GameConstantsData Data { get; private set; } = new GameConstantsData();

    public static void Load(GameConstantsData data)
    {
        Data = data;
        Debug.Log("[GameConstants] Loaded from server.");
    }
}
```

- [ ] **Step 4: Install required packages via Package Manager**

Window → Package Manager → install:
- Input System (com.unity.inputsystem)
- TextMeshPro (com.unity.textmeshpro)
- Cinemachine (com.unity.cinemachine)
- Test Framework (com.unity.test-framework) — for EditMode/PlayMode tests

- [ ] **Step 5: Commit**

```bash
cd client && git add . && git commit -m "feat: Unity project scaffold with URP"
```

---

## Task 2: API client & models

**Files:**
- Create: `Assets/Scripts/Api/Models.cs`
- Create: `Assets/Scripts/Api/ApiClient.cs`

- [ ] **Step 1: Create `Assets/Scripts/Api/Models.cs`**

```csharp
using System;
using System.Collections.Generic;

[Serializable]
public class SignInRequest { public string appleUserId; public string identityToken; }

[Serializable]
public class SignInResponse { public string token; public PlayerData player; }

[Serializable]
public class PlayerData
{
    public string id;
    public string nickname;
    public int mana;
    public int stamina;
    public int hearts;
    public string weaponName;
    public int weaponTier;
    public bool isOnline;
}

[Serializable]
public class PlayerMeResponse
{
    public PlayerData player;
    public List<MessageData> messages;
    public int totalManaStolen;
    public GameConstantsData constants;
}

[Serializable]
public class MessageData
{
    public string fromNickname;
    public string emoji;
    public int manaStolen;
    public string createdAt;
}

[Serializable]
public class SessionStartResponse
{
    public PlayerData player;
    public List<PortalData> portals;
}

[Serializable]
public class PortalData
{
    public string portalId;
    public string ownerNickname;
    public int ownerMana;
    public bool isMetaKing;
}

[Serializable]
public class PortalEnterRequest { public string portalId; public string emoji; }

[Serializable]
public class PortalEnterResponse
{
    public bool success;
    public string error;
    public int playerMana;
    public int playerStamina;
    public PortalData newPortal;
    public string weaponName;
    public int weaponTier;
}

[Serializable]
public class LeaderboardResponse { public List<LeaderboardEntry> entries; }

[Serializable]
public class LeaderboardEntry
{
    public int rank;
    public string nickname;
    public int mana;
    public int weaponTier;
    public bool isMetaKing;
    public string type;
}

[Serializable]
public class EntitlementResponse { public bool active; public string expiresAt; }

[Serializable]
public class NicknameRequest { public string nickname; }

[Serializable]
public class NicknameResponse { public string nickname; }

[Serializable]
public class ApiError { public string error; }
```

- [ ] **Step 2: Create `Assets/Scripts/Api/ApiClient.cs`**

```csharp
using System;
using System.Collections;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

public class ApiClient : MonoBehaviour
{
    public static ApiClient Instance { get; private set; }

    [SerializeField] private string baseUrl = "https://api.metaking.io";

    private string _jwt;

    void Awake()
    {
        if (Instance != null) { Destroy(gameObject); return; }
        Instance = this;
        DontDestroyOnLoad(gameObject);
        _jwt = PlayerPrefs.GetString("jwt", null);
    }

    public void SetJwt(string token)
    {
        _jwt = token;
        PlayerPrefs.SetString("jwt", token);
        PlayerPrefs.Save();
    }

    public bool HasJwt() => !string.IsNullOrEmpty(_jwt);

    // --- Generic helpers ---

    public IEnumerator Post<TReq, TRes>(string path, TReq body, Action<TRes> onSuccess, Action<string> onError)
    {
        var json = JsonUtility.ToJson(body);
        using var req = new UnityWebRequest(baseUrl + path, "POST");
        req.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(json));
        req.downloadHandler = new DownloadHandlerBuffer();
        req.SetRequestHeader("Content-Type", "application/json");
        if (!string.IsNullOrEmpty(_jwt))
            req.SetRequestHeader("Authorization", "Bearer " + _jwt);

        yield return req.SendWebRequest();

        if (req.result == UnityWebRequest.Result.Success)
        {
            var result = JsonUtility.FromJson<TRes>(req.downloadHandler.text);
            onSuccess?.Invoke(result);
        }
        else
        {
            var err = TryParseError(req.downloadHandler.text) ?? req.error;
            onError?.Invoke(err);
        }
    }

    public IEnumerator Get<TRes>(string path, Action<TRes> onSuccess, Action<string> onError)
    {
        using var req = UnityWebRequest.Get(baseUrl + path);
        if (!string.IsNullOrEmpty(_jwt))
            req.SetRequestHeader("Authorization", "Bearer " + _jwt);

        yield return req.SendWebRequest();

        if (req.result == UnityWebRequest.Result.Success)
        {
            var result = JsonUtility.FromJson<TRes>(req.downloadHandler.text);
            onSuccess?.Invoke(result);
        }
        else
        {
            var err = TryParseError(req.downloadHandler.text) ?? req.error;
            onError?.Invoke(err);
        }
    }

    // --- Typed endpoint wrappers ---

    public IEnumerator SignIn(string appleUserId, string identityToken, Action<SignInResponse> onSuccess, Action<string> onError)
        => Post("/auth/signin", new SignInRequest { appleUserId = appleUserId, identityToken = identityToken }, onSuccess, onError);

    public IEnumerator GetPlayerMe(Action<PlayerMeResponse> onSuccess, Action<string> onError)
        => Get("/player/me", onSuccess, onError);

    public IEnumerator StartSession(Action<SessionStartResponse> onSuccess, Action<string> onError)
        => Post<object, SessionStartResponse>("/session/start", new object(), onSuccess, onError);

    public IEnumerator EndSession(Action onDone)
        => Post<object, object>("/session/end", new object(), _ => onDone?.Invoke(), _ => onDone?.Invoke());

    public IEnumerator EnterPortal(string portalId, string emoji, Action<PortalEnterResponse> onSuccess, Action<string> onError)
        => Post("/portal/enter", new PortalEnterRequest { portalId = portalId, emoji = emoji }, onSuccess, onError);

    public IEnumerator GetLeaderboard(Action<LeaderboardResponse> onSuccess, Action<string> onError)
        => Get("/leaderboard", onSuccess, onError);

    public IEnumerator CheckEntitlement(Action<EntitlementResponse> onSuccess, Action<string> onError)
        => Get("/entitlement", onSuccess, onError);

    public IEnumerator SetNickname(string nickname, Action<NicknameResponse> onSuccess, Action<string> onError)
        => Post("/player/nickname", new NicknameRequest { nickname = nickname }, onSuccess, onError);

    private static string TryParseError(string json)
    {
        try { return JsonUtility.FromJson<ApiError>(json)?.error; }
        catch { return null; }
    }
}
```

- [ ] **Step 3: Create `Assets/Scripts/Utils/CoroutineHelper.cs`**

```csharp
using System.Collections;
using UnityEngine;

public class CoroutineHelper : MonoBehaviour
{
    private static CoroutineHelper _instance;

    public static CoroutineHelper Instance
    {
        get
        {
            if (_instance == null)
            {
                var go = new GameObject("CoroutineHelper");
                _instance = go.AddComponent<CoroutineHelper>();
                DontDestroyOnLoad(go);
            }
            return _instance;
        }
    }

    public static Coroutine Run(IEnumerator routine) => Instance.StartCoroutine(routine);
}
```

- [ ] **Step 4: Commit**

```bash
git add . && git commit -m "feat: ApiClient and data models"
```

---

## Task 3: PlayerVitals (state + events) with EditMode tests

**Files:**
- Create: `Assets/Scripts/Player/PlayerVitals.cs`
- Create: `Assets/Tests/EditMode/PlayerVitalsTests.cs`

- [ ] **Step 1: Write failing EditMode tests**

Create `Assets/Tests/EditMode/PlayerVitalsTests.cs`:

```csharp
using NUnit.Framework;

public class PlayerVitalsTests
{
    [Test]
    public void TakeDamage_ReducesHeartsAndStamina()
    {
        var vitals = new PlayerVitalsLogic(100, 50, 20);
        vitals.TakeWarlockHit(1, 1);
        Assert.AreEqual(19, vitals.Hearts);
        Assert.AreEqual(49, vitals.Stamina);
    }

    [Test]
    public void StaminaNeverGoesBelowMin()
    {
        var vitals = new PlayerVitalsLogic(100, 10, 20);
        vitals.TakeWarlockHit(1, 1);
        Assert.AreEqual(10, vitals.Stamina); // already at min
    }

    [Test]
    public void KillWarlock_IncreasesStamina()
    {
        var vitals = new PlayerVitalsLogic(100, 10, 20);
        vitals.KillWarlock(5);
        Assert.AreEqual(15, vitals.Stamina);
    }

    [Test]
    public void CollectHeart_RestoresHearts()
    {
        var vitals = new PlayerVitalsLogic(100, 10, 10);
        vitals.CollectHeart(5, 20);
        Assert.AreEqual(15, vitals.Hearts);
    }

    [Test]
    public void CollectHeart_DoesNotExceedMax()
    {
        var vitals = new PlayerVitalsLogic(100, 10, 19);
        vitals.CollectHeart(5, 20);
        Assert.AreEqual(20, vitals.Hearts);
    }

    [Test]
    public void Death_ResetsCorrectly()
    {
        var vitals = new PlayerVitalsLogic(500, 80, 5);
        vitals.ApplyDeath(50, 10, 20);
        Assert.AreEqual(450, vitals.Mana);
        Assert.AreEqual(10, vitals.Stamina);
        Assert.AreEqual(20, vitals.Hearts);
    }

    [Test]
    public void Death_ManaNeverGoesBelowMin()
    {
        var vitals = new PlayerVitalsLogic(110, 10, 0);
        vitals.ApplyDeath(50, 10, 20);
        Assert.AreEqual(100, vitals.Mana);
    }

    [Test]
    public void UsePortal_DeductsStamina()
    {
        var vitals = new PlayerVitalsLogic(200, 80, 20);
        bool ok = vitals.TryUsePortal(40, 50, 10);
        Assert.IsTrue(ok);
        Assert.AreEqual(40, vitals.Stamina);
        Assert.AreEqual(210, vitals.Mana);
    }

    [Test]
    public void UsePortal_FailsWithInsufficientStamina()
    {
        var vitals = new PlayerVitalsLogic(200, 30, 20);
        bool ok = vitals.TryUsePortal(40, 50, 10);
        Assert.IsFalse(ok);
        Assert.AreEqual(200, vitals.Mana); // unchanged
    }
}
```

- [ ] **Step 2: Create `Assets/Scripts/Player/PlayerVitals.cs`** (contains both pure logic class and MonoBehaviour)

```csharp
using System;
using UnityEngine;

// Pure logic class for testing — no MonoBehaviour dependency
public class PlayerVitalsLogic
{
    public int Mana { get; private set; }
    public int Stamina { get; private set; }
    public int Hearts { get; private set; }

    public PlayerVitalsLogic(int mana, int stamina, int hearts)
    {
        Mana = mana; Stamina = stamina; Hearts = hearts;
    }

    public void TakeWarlockHit(int heartDamage, int staminaDamage)
    {
        Hearts = Mathf.Max(0, Hearts - heartDamage);
        Stamina = Mathf.Max(GameConstants.Data.staminaMin, Stamina - staminaDamage);
    }

    public void KillWarlock(int staminaGain)
    {
        Stamina += staminaGain;
    }

    public void CollectHeart(int restore, int max)
    {
        Hearts = Mathf.Min(max, Hearts + restore);
    }

    public void ApplyDeath(int manaPenalty, int staminaReset, int heartsReset)
    {
        Mana = Mathf.Max(GameConstants.Data.manaMin, Mana - manaPenalty);
        Stamina = staminaReset;
        Hearts = heartsReset;
    }

    public bool TryUsePortal(int staminaCost, int staminaRequired, int manaGain)
    {
        if (Stamina < staminaRequired) return false;
        Stamina = Mathf.Max(GameConstants.Data.staminaMin, Stamina - staminaCost);
        Mana += manaGain;
        return true;
    }
}

public class PlayerVitals : MonoBehaviour
{
    public event Action OnDeath;
    public event Action<int> OnManaChanged;
    public event Action<int> OnStaminaChanged;
    public event Action<int> OnHeartsChanged;

    private PlayerVitalsLogic _logic;

    public int Mana => _logic.Mana;
    public int Stamina => _logic.Stamina;
    public int Hearts => _logic.Hearts;

    public void Init(int mana, int stamina, int hearts)
    {
        _logic = new PlayerVitalsLogic(mana, stamina, hearts);
    }

    public void TakeWarlockHit()
    {
        _logic.TakeWarlockHit(GameConstants.Data.warlockHitHearts, GameConstants.Data.warlockHitStamina);
        OnHeartsChanged?.Invoke(_logic.Hearts);
        OnStaminaChanged?.Invoke(_logic.Stamina);
        if (_logic.Hearts <= 0) OnDeath?.Invoke();
    }

    public void KillWarlock()
    {
        _logic.KillWarlock(GameConstants.Data.warlockKillStamina);
        OnStaminaChanged?.Invoke(_logic.Stamina);
    }

    public void CollectHeart()
    {
        _logic.CollectHeart(GameConstants.Data.heartPickupRestore, GameConstants.Data.heartsMax);
        OnHeartsChanged?.Invoke(_logic.Hearts);
    }

    public bool TryUsePortal()
    {
        bool ok = _logic.TryUsePortal(
            GameConstants.Data.portalStaminaCost,
            GameConstants.Data.portalStaminaRequired,
            GameConstants.Data.portalManaGain);
        if (ok)
        {
            OnManaChanged?.Invoke(_logic.Mana);
            OnStaminaChanged?.Invoke(_logic.Stamina);
        }
        return ok;
    }

    public void ApplyDeath()
    {
        _logic.ApplyDeath(
            GameConstants.Data.deathManaPenalty,
            GameConstants.Data.deathStaminaReset,
            GameConstants.Data.deathHeartsReset);
        OnManaChanged?.Invoke(_logic.Mana);
        OnStaminaChanged?.Invoke(_logic.Stamina);
        OnHeartsChanged?.Invoke(_logic.Hearts);
    }
}
```

- [ ] **Step 3: Run EditMode tests**

Unity → Window → General → Test Runner → EditMode → Run All.
Expected: All 8 PlayerVitals tests pass.

- [ ] **Step 4: Commit**

```bash
git add . && git commit -m "feat: PlayerVitals with EditMode tests"
```

---

## Task 4: Island map — terrain, shader, camera

**Files:**
- Modify: `Assets/Scenes/Game.unity` (set up terrain + camera)
- Create: `Assets/Materials/IslandTerrain.mat`
- Create: `Assets/Materials/GrassSway.mat`
- Create: `Assets/Scripts/Map/MapBounds.cs`

- [ ] **Step 1: Build island terrain in Unity scene**

In `Game.unity`:
1. Create a Terrain object (GameObject → 3D Object → Terrain). Set Width=500, Length=500, Height=80.
2. Use Terrain tools to sculpt:
   - Raise central plateau (grassland)
   - Paint 2–3 mountain ridges (impassable — height > 30)
   - Stamp 4–6 forest cluster areas at lower elevation
   - Carve the island edge into cliff faces dropping to sea level
3. Paint terrain layers: grass (bright #52b788), rocky grey for mountains, dark soil under forests.
4. Add a large flat Plane mesh below sea level painted deep teal to represent the surrounding ocean void.

- [ ] **Step 2: Create low-poly cel-shaded terrain material**

Create `Assets/Materials/IslandTerrain.mat`:
- Shader: `Universal Render Pipeline/Lit`
- Surface Type: Opaque
- Base Color: #52b788 (grass green)
- Smoothness: 0
- Enable: Receive Shadows

For cel-shading outline effect:
- Duplicate the player/warlock meshes, flip normals, assign a solid black unlit material at 101% scale → produces classic cel outline without a custom shader.

- [ ] **Step 3: Create animated grass sway shader**

In Shader Graph: create `GrassSway.shadergraph`:
- Input: `_WindStrength` (0.05), `_WindSpeed` (1.2)
- Sample a scrolling noise texture on UV → add to vertex position X/Z
- Output: standard URP Lit surface
- Assign to all grass surface materials.

- [ ] **Step 4: Set up isometric camera with Cinemachine**

In `Game.unity`:
1. Add `CinemachineVirtualCamera` component.
2. Body: Transposer — Follow Offset: (0, 280, -180) → gives ~60° pitch bird's eye.
3. Aim: Do Nothing (fixed angle).
4. Follow: Player transform.
5. Lens: Orthographic Size 120 (covers plenty of the 500-unit map).

- [ ] **Step 5: Create `Assets/Scripts/Map/MapBounds.cs`**

```csharp
using UnityEngine;

public class MapBounds : MonoBehaviour
{
    public static MapBounds Instance { get; private set; }

    [SerializeField] private float mapHalfSize = 250f; // half of 500

    void Awake() { Instance = this; }

    public Vector3 Clamp(Vector3 position)
    {
        position.x = Mathf.Clamp(position.x, -mapHalfSize, mapHalfSize);
        position.z = Mathf.Clamp(position.z, -mapHalfSize, mapHalfSize);
        return position;
    }

    public bool IsInBounds(Vector3 position) =>
        Mathf.Abs(position.x) <= mapHalfSize && Mathf.Abs(position.z) <= mapHalfSize;

    public Vector3 RandomPointOnMap()
    {
        float x = Random.Range(-mapHalfSize * 0.8f, mapHalfSize * 0.8f);
        float z = Random.Range(-mapHalfSize * 0.8f, mapHalfSize * 0.8f);
        return new Vector3(x, 0f, z);
    }
}
```

- [ ] **Step 6: Commit**

```bash
git add . && git commit -m "feat: island terrain, cel-shaded materials, isometric camera"
```

---

## Task 5: Player movement & dodge roll

**Files:**
- Create: `Assets/Scripts/Player/PlayerController.cs`

- [ ] **Step 1: Create `Assets/Scripts/Player/PlayerController.cs`**

```csharp
using UnityEngine;
using UnityEngine.InputSystem;

[RequireComponent(typeof(CharacterController))]
[RequireComponent(typeof(PlayerVitals))]
public class PlayerController : MonoBehaviour
{
    [SerializeField] private float moveSpeed = 12f;
    [SerializeField] private float dodgeSpeed = 30f;
    [SerializeField] private float dodgeDuration = 0.2f;
    [SerializeField] private float dodgeCooldown = 1.0f;

    private CharacterController _cc;
    private PlayerVitals _vitals;
    private Vector2 _moveInput;
    private bool _isDodging;
    private bool _canDodge = true;
    private Vector3 _dodgeDirection;
    private float _dodgeTimer;
    private float _dodgeCooldownTimer;

    // Virtual joystick reference — set by HUD
    public static PlayerController Instance { get; private set; }

    void Awake()
    {
        Instance = this;
        _cc = GetComponent<CharacterController>();
        _vitals = GetComponent<PlayerVitals>();
    }

    // Called by virtual joystick UI
    public void SetMoveInput(Vector2 input) => _moveInput = input;

    public void TriggerDodge()
    {
        if (!_canDodge || _isDodging) return;
        _isDodging = true;
        _canDodge = false;
        _dodgeTimer = dodgeDuration;
        _dodgeCooldownTimer = dodgeCooldown;
        _dodgeDirection = new Vector3(_moveInput.x, 0, _moveInput.y).normalized;
        if (_dodgeDirection == Vector3.zero) _dodgeDirection = transform.forward;
    }

    public bool IsDodging => _isDodging;

    void Update()
    {
        if (_isDodging)
        {
            _dodgeTimer -= Time.deltaTime;
            _cc.Move(_dodgeDirection * dodgeSpeed * Time.deltaTime);
            if (_dodgeTimer <= 0) _isDodging = false;
        }
        else
        {
            var dir = new Vector3(_moveInput.x, 0, _moveInput.y);
            if (dir.sqrMagnitude > 0.01f)
            {
                transform.forward = dir;
                _cc.Move(dir.normalized * moveSpeed * Time.deltaTime);
            }
            _cc.Move(Vector3.down * 9.8f * Time.deltaTime); // gravity
        }

        // Clamp to map
        var clamped = MapBounds.Instance.Clamp(transform.position);
        if (clamped != transform.position)
            transform.position = clamped;

        // Dodge cooldown
        if (!_canDodge)
        {
            _dodgeCooldownTimer -= Time.deltaTime;
            if (_dodgeCooldownTimer <= 0) _canDodge = true;
        }
    }
}
```

- [ ] **Step 2: Create Player prefab**

1. Create empty GameObject `Player`.
2. Add `CharacterController` (radius=0.5, height=2).
3. Add a knight mesh (use Unity asset store low-poly knight or simple capsule placeholder).
4. Add `PlayerController`, `PlayerVitals`, `PlayerCombat`, `PlayerWeapon` components.
5. Save as `Assets/Prefabs/Player.prefab`.

- [ ] **Step 3: Commit**

```bash
git add . && git commit -m "feat: player movement and dodge roll"
```

---

## Task 6: Warlock AI & spawn manager

**Files:**
- Create: `Assets/Scripts/Warlocks/WarlockAI.cs`
- Create: `Assets/Scripts/Warlocks/WarlockGroup.cs`
- Create: `Assets/Scripts/Warlocks/WarlockSpawnManager.cs`

- [ ] **Step 1: Create `Assets/Scripts/Warlocks/WarlockAI.cs`**

```csharp
using UnityEngine;

public enum WarlockState { Patrolling, Chasing }

[RequireComponent(typeof(CharacterController))]
public class WarlockAI : MonoBehaviour
{
    [SerializeField] private float patrolSpeed = 4f;
    [SerializeField] private float chaseSpeed = 9f; // slightly slower than player's 12
    [SerializeField] private float attackRange = 1.5f;
    [SerializeField] private float attackCooldown = 1.2f;

    private WarlockState _state = WarlockState.Patrolling;
    private Vector3 _patrolTarget;
    private CharacterController _cc;
    private Transform _player;
    private float _attackTimer;
    public WarlockGroup Group { get; set; }

    void Awake()
    {
        _cc = GetComponent<CharacterController>();
        _player = GameObject.FindWithTag("Player")?.transform;
        SetNewPatrolTarget();
    }

    void Update()
    {
        if (_player == null) return;
        float distToPlayer = Vector3.Distance(transform.position, _player.position);

        _state = distToPlayer <= GameConstants.Data.warlockChaseRadius
            ? WarlockState.Chasing
            : WarlockState.Patrolling;

        if (_state == WarlockState.Chasing)
            ChasePlayer(distToPlayer);
        else
            Patrol();
    }

    private void ChasePlayer(float dist)
    {
        MoveTo(_player.position, chaseSpeed);

        _attackTimer -= Time.deltaTime;
        if (dist <= attackRange && _attackTimer <= 0)
        {
            _attackTimer = attackCooldown;
            var vitals = _player.GetComponent<PlayerVitals>();
            var controller = _player.GetComponent<PlayerController>();
            if (vitals != null && !(controller?.IsDodging ?? false))
                vitals.TakeWarlockHit();
        }
    }

    private void Patrol()
    {
        MoveTo(_patrolTarget, patrolSpeed);
        if (Vector3.Distance(transform.position, _patrolTarget) < 1f)
            SetNewPatrolTarget();
    }

    private void MoveTo(Vector3 target, float speed)
    {
        var dir = (target - transform.position).normalized;
        dir.y = 0;
        if (dir.sqrMagnitude > 0.01f) transform.forward = dir;
        _cc.Move(dir * speed * Time.deltaTime);
        _cc.Move(Vector3.down * 9.8f * Time.deltaTime);
    }

    private void SetNewPatrolTarget()
    {
        _patrolTarget = MapBounds.Instance.RandomPointOnMap();
    }

    public void Die()
    {
        _player.GetComponent<PlayerVitals>()?.KillWarlock();
        Group?.OnWarlockDied(this);
        Destroy(gameObject);
    }

    void OnTriggerEnter(Collider other)
    {
        if (other.CompareTag("PlayerWeapon"))
            Die();
    }
}
```

- [ ] **Step 2: Create `Assets/Scripts/Warlocks/WarlockGroup.cs`**

```csharp
using System.Collections.Generic;
using UnityEngine;

public class WarlockGroup : MonoBehaviour
{
    private List<WarlockAI> _warlocks = new();

    public void AddWarlock(WarlockAI w) { w.Group = this; _warlocks.Add(w); }

    public void OnWarlockDied(WarlockAI w)
    {
        _warlocks.Remove(w);
        if (_warlocks.Count == 0)
        {
            WarlockSpawnManager.Instance?.OnGroupCleared(this);
            Destroy(gameObject);
        }
    }

    public int Count => _warlocks.Count;
}
```

- [ ] **Step 3: Create `Assets/Scripts/Warlocks/WarlockSpawnManager.cs`**

```csharp
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class WarlockSpawnManager : MonoBehaviour
{
    public static WarlockSpawnManager Instance { get; private set; }

    [SerializeField] private GameObject warlockPrefab;
    [SerializeField] private Camera mainCamera;

    private List<WarlockGroup> _activeGroups = new();

    void Awake() { Instance = this; }

    void Start() { StartCoroutine(MaintainDensity()); }

    private IEnumerator MaintainDensity()
    {
        // Initial spawn
        int targetGroups = Random.Range(GameConstants.Data.warlockGroupsMin, GameConstants.Data.warlockGroupsMax + 1);
        while (_activeGroups.Count < targetGroups)
        {
            SpawnGroup();
            yield return null;
        }

        while (true)
        {
            yield return new WaitForSeconds(2f);
            int target = Random.Range(GameConstants.Data.warlockGroupsMin, GameConstants.Data.warlockGroupsMax + 1);
            while (_activeGroups.Count < target)
                SpawnGroup();
        }
    }

    private void SpawnGroup()
    {
        var spawnPos = GetOffScreenPosition();
        var groupGo = new GameObject("WarlockGroup");
        var group = groupGo.AddComponent<WarlockGroup>();

        int count = Random.Range(GameConstants.Data.warlockGroupSizeMin, GameConstants.Data.warlockGroupSizeMax + 1);
        for (int i = 0; i < count; i++)
        {
            var offset = new Vector3(Random.Range(-4f, 4f), 0, Random.Range(-4f, 4f));
            var w = Instantiate(warlockPrefab, spawnPos + offset, Quaternion.identity);
            group.AddWarlock(w.GetComponent<WarlockAI>());
        }

        _activeGroups.Add(group);
    }

    public void OnGroupCleared(WarlockGroup group)
    {
        _activeGroups.Remove(group);
        // Immediately queue a replacement — spawns off-screen next cycle
    }

    private Vector3 GetOffScreenPosition()
    {
        // Pick a point outside the camera frustum but inside the map
        Vector3 candidate;
        int attempts = 0;
        do
        {
            candidate = MapBounds.Instance.RandomPointOnMap();
            attempts++;
            if (attempts > 100) break;
        }
        while (IsOnScreen(candidate));
        return candidate;
    }

    private bool IsOnScreen(Vector3 worldPos)
    {
        if (mainCamera == null) return false;
        var vp = mainCamera.WorldToViewportPoint(worldPos);
        return vp.x > 0 && vp.x < 1 && vp.y > 0 && vp.y < 1 && vp.z > 0;
    }
}
```

- [ ] **Step 4: Create Warlock prefab**

1. Create empty GameObject `Warlock`, add `CharacterController` (radius=0.4, height=1.8).
2. Add low-poly robed mesh (dark purple/black) or simple capsule placeholder.
3. Add `WarlockAI` component.
4. Add a child `SphereCollider` (trigger, radius=1.5) tagged `WarlockHitbox`.
5. Save as `Assets/Prefabs/Warlock.prefab`.

- [ ] **Step 5: Commit**

```bash
git add . && git commit -m "feat: warlock AI patrol/chase and spawn manager"
```

---

## Task 7: Player combat (auto-attack)

**Files:**
- Create: `Assets/Scripts/Player/PlayerCombat.cs`
- Create: `Assets/Scripts/Player/PlayerWeapon.cs`

- [ ] **Step 1: Create `Assets/Scripts/Player/PlayerWeapon.cs`**

```csharp
using UnityEngine;

[System.Serializable]
public struct WeaponStats
{
    public string name;
    public int tier;
    public float attackRange;
    public float attackSpeed; // attacks per second
}

public class PlayerWeapon : MonoBehaviour
{
    public static readonly WeaponStats[] AllWeapons = new[]
    {
        new WeaponStats { name = "Sword",                    tier = 1, attackRange = 2.0f, attackSpeed = 1.5f },
        new WeaponStats { name = "Staff",                    tier = 1, attackRange = 3.0f, attackSpeed = 1.0f },
        new WeaponStats { name = "War Axe",                  tier = 2, attackRange = 2.2f, attackSpeed = 1.3f },
        new WeaponStats { name = "Spear",                    tier = 2, attackRange = 3.5f, attackSpeed = 1.2f },
        new WeaponStats { name = "Flail",                    tier = 3, attackRange = 2.5f, attackSpeed = 1.4f },
        new WeaponStats { name = "Lightning Wand",           tier = 3, attackRange = 5.0f, attackSpeed = 0.8f },
        new WeaponStats { name = "Void Blade",               tier = 4, attackRange = 2.5f, attackSpeed = 2.0f },
        new WeaponStats { name = "Frost Lance",              tier = 4, attackRange = 6.0f, attackSpeed = 0.9f },
        new WeaponStats { name = "Soul Reaper",              tier = 5, attackRange = 3.0f, attackSpeed = 1.8f },
        new WeaponStats { name = "MetaKing's Crown Scepter", tier = 5, attackRange = 4.0f, attackSpeed = 1.5f },
        new WeaponStats { name = "Shadowfang",               tier = 6, attackRange = 3.0f, attackSpeed = 2.2f },
        new WeaponStats { name = "Arcane Devastator",        tier = 6, attackRange = 5.5f, attackSpeed = 1.1f },
        new WeaponStats { name = "Worldbreaker",             tier = 7, attackRange = 4.0f, attackSpeed = 2.0f },
        new WeaponStats { name = "Eternal Flame Staff",      tier = 7, attackRange = 7.0f, attackSpeed = 1.0f },
        new WeaponStats { name = "Oblivion Scythe",          tier = 8, attackRange = 4.5f, attackSpeed = 2.5f },
        new WeaponStats { name = "Titan's Wrath",            tier = 8, attackRange = 3.5f, attackSpeed = 2.8f },
        new WeaponStats { name = "The MetaKing Blade",       tier = 9, attackRange = 99f,  attackSpeed = 2.0f }, // AOE hits all
    };

    public WeaponStats Current { get; private set; }

    void Start() => EquipByName("Sword");

    public void EquipByName(string weaponName)
    {
        foreach (var w in AllWeapons)
            if (w.name == weaponName) { Current = w; return; }
        Current = AllWeapons[0];
    }
}
```

- [ ] **Step 2: Create `Assets/Scripts/Player/PlayerCombat.cs`**

```csharp
using System.Collections;
using UnityEngine;

[RequireComponent(typeof(PlayerVitals))]
[RequireComponent(typeof(PlayerWeapon))]
public class PlayerCombat : MonoBehaviour
{
    private PlayerVitals _vitals;
    private PlayerWeapon _weapon;
    private float _attackTimer;
    private bool _isAttacking;

    void Awake()
    {
        _vitals = GetComponent<PlayerVitals>();
        _weapon = GetComponent<PlayerWeapon>();
    }

    void Update()
    {
        _attackTimer -= Time.deltaTime;
        if (_attackTimer > 0) return;

        // Find nearest warlock in range
        var colliders = Physics.OverlapSphere(transform.position, _weapon.Current.attackRange);
        foreach (var col in colliders)
        {
            var warlock = col.GetComponentInParent<WarlockAI>();
            if (warlock == null) continue;

            // Attack — tier 9 hits all in range
            if (_weapon.Current.tier == 9)
            {
                foreach (var c2 in colliders)
                    c2.GetComponentInParent<WarlockAI>()?.Die();
            }
            else
            {
                warlock.Die();
            }

            _attackTimer = 1f / _weapon.Current.attackSpeed;
            StartCoroutine(AttackAnimation());
            break;
        }
    }

    private IEnumerator AttackAnimation()
    {
        // Trigger animation param if Animator exists
        var anim = GetComponent<Animator>();
        anim?.SetTrigger("Attack");
        yield return new WaitForSeconds(0.15f);
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add . && git commit -m "feat: auto-attack combat with weapon stats"
```

---

## Task 8: Portal system

**Files:**
- Create: `Assets/Scripts/Portals/Portal.cs`
- Create: `Assets/Scripts/Portals/PortalManager.cs`

- [ ] **Step 1: Create `Assets/Scripts/Portals/Portal.cs`**

```csharp
using TMPro;
using UnityEngine;

public class Portal : MonoBehaviour
{
    [SerializeField] private TextMeshPro nameplate;
    [SerializeField] private ParticleSystem glowParticles;
    [SerializeField] private Renderer portalRenderer;

    public PortalData Data { get; private set; }

    private static readonly Color NormalColor = new Color(0.61f, 0.31f, 0.87f); // purple
    private static readonly Color MetaKingColor = new Color(1f, 0.84f, 0f);     // gold
    private static readonly Color LockedColor = new Color(0.8f, 0.2f, 0.2f);    // red

    public void Setup(PortalData data)
    {
        Data = data;
        nameplate.text = $"{data.ownerNickname}\n{data.ownerMana} mana";

        var col = data.isMetaKing ? MetaKingColor : NormalColor;
        portalRenderer.material.SetColor("_EmissionColor", col * 3f);
        var main = glowParticles.main;
        main.startColor = col;
    }

    public void SetLocked(bool locked)
    {
        var col = locked ? LockedColor : (Data?.isMetaKing == true ? MetaKingColor : NormalColor);
        portalRenderer.material.SetColor("_EmissionColor", col * 3f);
    }

    void OnTriggerEnter(Collider other)
    {
        if (!other.CompareTag("Player")) return;
        var vitals = other.GetComponent<PlayerVitals>();
        bool canEnter = vitals != null && vitals.Stamina >= GameConstants.Data.portalStaminaRequired;
        SetLocked(!canEnter);
        PortalManager.Instance?.OnPlayerEnterPortalTrigger(this, canEnter);
    }

    void OnTriggerExit(Collider other)
    {
        if (other.CompareTag("Player"))
            PortalManager.Instance?.OnPlayerExitPortalTrigger(this);
    }
}
```

- [ ] **Step 2: Create `Assets/Scripts/Portals/PortalManager.cs`**

```csharp
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class PortalManager : MonoBehaviour
{
    public static PortalManager Instance { get; private set; }

    [SerializeField] private GameObject portalPrefab;
    [SerializeField] private Transform[] spawnPoints; // pre-placed clearings on map

    private List<Portal> _activePortals = new();

    void Awake() { Instance = this; }

    public void InitPortals(List<PortalData> portalDataList)
    {
        foreach (var data in portalDataList)
        {
            var pos = GetRandomSpawnPoint();
            var go = Instantiate(portalPrefab, pos, Quaternion.identity);
            var portal = go.GetComponent<Portal>();
            portal.Setup(data);
            _activePortals.Add(portal);
        }
    }

    private Vector3 GetRandomSpawnPoint()
    {
        if (spawnPoints != null && spawnPoints.Length > 0)
            return spawnPoints[Random.Range(0, spawnPoints.Length)].position;
        return MapBounds.Instance.RandomPointOnMap();
    }

    public void OnPlayerEnterPortalTrigger(Portal portal, bool canEnter)
    {
        if (!canEnter)
        {
            // Show tooltip — handled by HUD listening to this event
            HUD.Instance?.ShowPortalLockedTooltip();
            return;
        }
        HUD.Instance?.ShowPortalConfirm(portal.Data, confirmedEmoji =>
        {
            StartCoroutine(ExecutePortalEntry(portal, confirmedEmoji));
        });
    }

    public void OnPlayerExitPortalTrigger(Portal portal)
    {
        HUD.Instance?.HidePortalConfirm();
    }

    private IEnumerator ExecutePortalEntry(Portal portal, string emoji)
    {
        string portalId = portal.Data.portalId;
        bool done = false;
        PortalEnterResponse response = null;

        yield return ApiClient.Instance.EnterPortal(portalId, emoji,
            r => { response = r; done = true; },
            err => { Debug.LogError($"Portal entry failed: {err}"); done = true; });

        yield return new WaitUntil(() => done);

        if (response == null || !response.success)
        {
            HUD.Instance?.ShowToast(response?.error ?? "Portal failed");
            yield break;
        }

        // Update local vitals from server response
        var vitals = FindObjectOfType<PlayerVitals>();
        vitals?.Init(response.playerMana, response.playerStamina, vitals.Hearts);

        // Replace portal
        _activePortals.Remove(portal);
        Destroy(portal.gameObject);

        if (response.newPortal != null)
        {
            var pos = GetRandomSpawnPoint();
            var go = Instantiate(portalPrefab, pos, Quaternion.identity);
            var newPortal = go.GetComponent<Portal>();
            newPortal.Setup(response.newPortal);
            _activePortals.Add(newPortal);
        }

        HUD.Instance?.ShowToast($"+{GameConstants.Data.portalManaGain} mana!");
    }
}
```

- [ ] **Step 3: Create Portal prefab**

1. Create empty GameObject `Portal`.
2. Add a torus mesh (or import a stylised ring mesh) with emissive URP material.
3. Add a `ParticleSystem` child for swirling particles.
4. Add a `TextMeshPro` child for nameplate (world-space canvas, always face camera).
5. Add `Portal` script, `SphereCollider` (trigger, radius=2.5).
6. Save as `Assets/Prefabs/Portal.prefab`.

- [ ] **Step 4: Commit**

```bash
git add . && git commit -m "feat: portal spawn, interaction and server entry"
```

---

## Task 9: Heart pickups & minimap

**Files:**
- Create: `Assets/Scripts/Pickups/HeartPickup.cs`
- Create: `Assets/Scripts/Map/MinimapController.cs`

- [ ] **Step 1: Create `Assets/Scripts/Pickups/HeartPickup.cs`**

```csharp
using System.Collections;
using UnityEngine;

public class HeartPickup : MonoBehaviour
{
    private bool _collected;

    void OnTriggerEnter(Collider other)
    {
        if (_collected || !other.CompareTag("Player")) return;
        _collected = true;

        other.GetComponent<PlayerVitals>()?.CollectHeart();
        GetComponent<Renderer>().enabled = false;
        GetComponent<Collider>().enabled = false;

        StartCoroutine(Respawn());
    }

    private IEnumerator Respawn()
    {
        yield return new WaitForSeconds(GameConstants.Data.heartPickupRespawnSeconds);
        transform.position = MapBounds.Instance.RandomPointOnMap() + Vector3.up * 0.5f;
        GetComponent<Renderer>().enabled = true;
        GetComponent<Collider>().enabled = true;
        _collected = false;
    }
}
```

- [ ] **Step 2: Scatter heart pickups in scene**

1. Create a heart mesh GameObject (stylised red low-poly heart or simple cube placeholder).
2. Add `HeartPickup` script and `SphereCollider` (trigger, radius=1).
3. Place 8 instances across the map in clearings.
4. Tag them `HeartPickup`.

- [ ] **Step 3: Create `Assets/Scripts/Map/MinimapController.cs`**

```csharp
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class MinimapController : MonoBehaviour
{
    [SerializeField] private RawImage minimapImage;
    [SerializeField] private RenderTexture minimapRT;
    [SerializeField] private Camera minimapCamera; // orthographic top-down camera
    [SerializeField] private Image playerBlip;
    [SerializeField] private Image[] portalBlips;  // 3 blips pre-created
    [SerializeField] private Image warlockBlipPrefab;
    [SerializeField] private float mapSize = 500f;

    private List<(Transform t, Image blip)> _warlockBlips = new();

    void Update()
    {
        UpdateBlipPosition(playerBlip, PlayerController.Instance?.transform);
        // Portal blips — updated by PortalManager
    }

    public Vector2 WorldToMinimapUV(Vector3 worldPos)
    {
        float u = (worldPos.x / mapSize) + 0.5f;
        float v = (worldPos.z / mapSize) + 0.5f;
        return new Vector2(u, v);
    }

    private void UpdateBlipPosition(Image blip, Transform target)
    {
        if (blip == null || target == null) return;
        var uv = WorldToMinimapUV(target.position);
        var rect = minimapImage.rectTransform.rect;
        blip.rectTransform.anchoredPosition = new Vector2(
            (uv.x - 0.5f) * rect.width,
            (uv.y - 0.5f) * rect.height);
    }
}
```

- [ ] **Step 4: Set up minimap camera**

1. Add a second Camera to scene, set Culling Mask to include terrain + warlocks + portals.
2. Set orthographic, size=280, position (0, 400, 0), rotation (90, 0, 0).
3. Assign a Render Texture (256×256) as its target.
4. Assign the Render Texture to a `RawImage` UI element in the HUD (bottom-right corner).

- [ ] **Step 5: Commit**

```bash
git add . && git commit -m "feat: heart pickups and minimap"
```

---

## Task 10: HUD

**Files:**
- Create: `Assets/Scripts/UI/HUD.cs`

- [ ] **Step 1: Create `Assets/Scripts/UI/HUD.cs`**

```csharp
using System;
using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class HUD : MonoBehaviour
{
    public static HUD Instance { get; private set; }

    [Header("Vitals")]
    [SerializeField] private TextMeshProUGUI manaLabel;
    [SerializeField] private TextMeshProUGUI staminaLabel;
    [SerializeField] private List<Image> heartIcons; // 20 heart images
    [SerializeField] private Image weaponIcon;
    [SerializeField] private TextMeshProUGUI weaponLabel;

    [Header("Panels")]
    [SerializeField] private PortalConfirmPanel portalConfirmPanel;
    [SerializeField] private LeaderboardPanel leaderboardPanel;
    [SerializeField] private GameObject portalLockedTooltip;
    [SerializeField] private TextMeshProUGUI toastLabel;

    [Header("Input")]
    [SerializeField] private Joystick moveJoystick;
    [SerializeField] private Button dodgeButton;
    [SerializeField] private Button leaderboardButton;

    void Awake() { Instance = this; }

    void Start()
    {
        dodgeButton.onClick.AddListener(() => PlayerController.Instance?.TriggerDodge());
        leaderboardButton.onClick.AddListener(() => leaderboardPanel.Toggle());
    }

    void Update()
    {
        PlayerController.Instance?.SetMoveInput(moveJoystick.Direction);
    }

    public void RefreshVitals(PlayerVitals vitals)
    {
        manaLabel.text = vitals.Mana.ToString("N0");
        staminaLabel.text = $"STM {vitals.Stamina}";
        for (int i = 0; i < heartIcons.Count; i++)
            heartIcons[i].enabled = i < vitals.Hearts;
    }

    public void SetWeapon(string name, int tier)
    {
        weaponLabel.text = name;
    }

    public void ShowPortalConfirm(PortalData data, Action<string> onConfirm)
    {
        portalConfirmPanel.gameObject.SetActive(true);
        portalConfirmPanel.Setup(data, onConfirm);
    }

    public void HidePortalConfirm() => portalConfirmPanel.gameObject.SetActive(false);

    public void ShowPortalLockedTooltip()
    {
        portalLockedTooltip.SetActive(true);
        StartCoroutine(HideAfter(portalLockedTooltip, 2f));
    }

    public void ShowToast(string message)
    {
        toastLabel.text = message;
        toastLabel.gameObject.SetActive(true);
        StartCoroutine(HideAfter(toastLabel.gameObject, 2.5f));
    }

    private IEnumerator HideAfter(GameObject go, float seconds)
    {
        yield return new WaitForSeconds(seconds);
        go.SetActive(false);
    }
}
```

- [ ] **Step 2: Build HUD Canvas in Unity**

1. Create a Canvas (Screen Space - Overlay, scale mode: Scale with Screen Size 1170×2532).
2. Top centre: Mana label (large, prominent).
3. Below mana: Stamina label.
4. Top right: 20 heart icons in 4 rows of 5.
5. Bottom left: weapon icon + label.
6. Bottom right: minimap RawImage (200×200).
7. Top right corner: leaderboard button.
8. Right side: dodge roll button (large, thumb-reachable).
9. Bottom left: virtual joystick (use Unity's OnScreenStick from Input System package).

- [ ] **Step 3: Commit**

```bash
git add . && git commit -m "feat: HUD with vitals, controls, and minimap"
```

---

## Task 11: Portal confirm panel & session summary

**Files:**
- Create: `Assets/Scripts/UI/PortalConfirmPanel.cs`
- Create: `Assets/Scripts/UI/SessionSummaryPanel.cs`

- [ ] **Step 1: Create `Assets/Scripts/UI/PortalConfirmPanel.cs`**

```csharp
using System;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class PortalConfirmPanel : MonoBehaviour
{
    [SerializeField] private TextMeshProUGUI titleLabel;
    [SerializeField] private TextMeshProUGUI manaLabel;
    [SerializeField] private List<Button> emojiButtons; // 12 buttons pre-created
    [SerializeField] private Button confirmButton;
    [SerializeField] private Button cancelButton;

    private static readonly string[] Emojis = { "👑", "⚔️", "💀", "🔥", "👻", "😈", "🙏", "✨", "😂", "🤝", "💎", "🌀" };
    private string _selectedEmoji;
    private Action<string> _onConfirm;

    public void Setup(PortalData data, Action<string> onConfirm)
    {
        _onConfirm = onConfirm;
        _selectedEmoji = Emojis[0];
        titleLabel.text = $"Visit {data.ownerNickname}'s world?";
        manaLabel.text = $"Their mana: {data.ownerMana:N0}  |  You gain: +{GameConstants.Data.portalManaGain} mana\nCost: {GameConstants.Data.portalStaminaCost} stamina";

        for (int i = 0; i < emojiButtons.Count; i++)
        {
            int idx = i;
            var label = emojiButtons[i].GetComponentInChildren<TextMeshProUGUI>();
            if (label != null) label.text = Emojis[i];
            emojiButtons[i].onClick.RemoveAllListeners();
            emojiButtons[i].onClick.AddListener(() => { _selectedEmoji = Emojis[idx]; });
        }

        confirmButton.onClick.RemoveAllListeners();
        confirmButton.onClick.AddListener(() => { _onConfirm?.Invoke(_selectedEmoji); gameObject.SetActive(false); });
        cancelButton.onClick.RemoveAllListeners();
        cancelButton.onClick.AddListener(() => gameObject.SetActive(false));
    }
}
```

- [ ] **Step 2: Create `Assets/Scripts/UI/SessionSummaryPanel.cs`**

```csharp
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class SessionSummaryPanel : MonoBehaviour
{
    [SerializeField] private TextMeshProUGUI headerLabel;
    [SerializeField] private TextMeshProUGUI manaLostLabel;
    [SerializeField] private Transform messageContainer;
    [SerializeField] private GameObject messageRowPrefab; // TextMeshProUGUI prefab
    [SerializeField] private Button continueButton;

    public void Show(PlayerMeResponse data, System.Action onContinue)
    {
        if (data.messages == null || data.messages.Count == 0)
        {
            // No offline events — skip summary
            onContinue?.Invoke();
            gameObject.SetActive(false);
            return;
        }

        gameObject.SetActive(true);
        headerLabel.text = "While you were away...";
        manaLostLabel.text = $"Mana stolen: -{data.totalManaStolen}";

        foreach (Transform child in messageContainer) Destroy(child.gameObject);
        foreach (var msg in data.messages)
        {
            var row = Instantiate(messageRowPrefab, messageContainer);
            var label = row.GetComponent<TextMeshProUGUI>();
            if (label != null)
                label.text = $"{msg.emoji}  {msg.fromNickname} stole {msg.manaStolen} mana";
        }

        continueButton.onClick.RemoveAllListeners();
        continueButton.onClick.AddListener(() => { gameObject.SetActive(false); onContinue?.Invoke(); });
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add . && git commit -m "feat: portal confirm panel and session summary"
```

---

## Task 12: Auth manager & game manager (session lifecycle)

**Files:**
- Create: `Assets/Scripts/Api/AuthManager.cs`
- Create: `Assets/Scripts/Game/GameManager.cs`
- Create: `Assets/Scripts/Game/DeathRespawn.cs`

- [ ] **Step 1: Create `Assets/Scripts/Api/AuthManager.cs`**

```csharp
using System;
using System.Collections;
using UnityEngine;

public class AuthManager : MonoBehaviour
{
    public static AuthManager Instance { get; private set; }
    public string PlayerId { get; private set; }
    public string AppleUserId { get; private set; }

    void Awake()
    {
        if (Instance != null) { Destroy(gameObject); return; }
        Instance = this;
        DontDestroyOnLoad(gameObject);
    }

    public IEnumerator SignInWithApple(Action<bool> onDone)
    {
        // TODO: integrate Apple Sign In Unity plugin
        // For now, use stored AppleUserId or prompt
        AppleUserId = PlayerPrefs.GetString("appleUserId", "");

        if (string.IsNullOrEmpty(AppleUserId))
        {
            // In production: call Apple Sign In plugin here
            // For editor testing: use a UUID
            AppleUserId = System.Guid.NewGuid().ToString();
            PlayerPrefs.SetString("appleUserId", AppleUserId);
            PlayerPrefs.Save();
        }

        bool done = false;
        bool success = false;
        yield return ApiClient.Instance.SignIn(AppleUserId, "identity-token-placeholder",
            res =>
            {
                ApiClient.Instance.SetJwt(res.token);
                PlayerId = res.player.id;
                success = true;
                done = true;
            },
            err =>
            {
                Debug.LogError($"Sign in failed: {err}");
                done = true;
            });

        yield return new WaitUntil(() => done);
        onDone?.Invoke(success);
    }
}
```

- [ ] **Step 2: Create `Assets/Scripts/Game/GameManager.cs`**

```csharp
using System.Collections;
using UnityEngine;
using UnityEngine.SceneManagement;

public class GameManager : MonoBehaviour
{
    public static GameManager Instance { get; private set; }

    [SerializeField] private PlayerVitals playerVitals;
    [SerializeField] private PlayerWeapon playerWeapon;
    [SerializeField] private PortalManager portalManager;
    [SerializeField] private SessionSummaryPanel summaryPanel;

    private PlayerMeResponse _playerData;

    void Awake() { Instance = this; }

    void Start() { StartCoroutine(StartSession()); }

    private IEnumerator StartSession()
    {
        // 1. Fetch player state and unseen messages
        bool done = false;
        yield return ApiClient.Instance.GetPlayerMe(
            res => { _playerData = res; done = true; },
            err => { Debug.LogError(err); done = true; });
        yield return new WaitUntil(() => done);

        if (_playerData == null) yield break;

        // Load server constants
        if (_playerData.constants != null)
            GameConstants.Load(_playerData.constants);

        // Init player vitals
        playerVitals.Init(_playerData.player.mana, _playerData.player.stamina, _playerData.player.hearts);
        playerWeapon.EquipByName(_playerData.player.weaponName ?? "Sword");
        HUD.Instance?.RefreshVitals(playerVitals);

        // Show summary if offline events occurred
        bool summaryDone = false;
        summaryPanel.Show(_playerData, () => summaryDone = true);
        yield return new WaitUntil(() => summaryDone);

        // 2. Start server session — marks online, gets portals
        done = false;
        SessionStartResponse sessionData = null;
        yield return ApiClient.Instance.StartSession(
            res => { sessionData = res; done = true; },
            err => { Debug.LogError(err); done = true; });
        yield return new WaitUntil(() => done);

        if (sessionData?.portals != null)
            portalManager.InitPortals(sessionData.portals);

        // Wire vitals events to HUD
        playerVitals.OnManaChanged += _ => HUD.Instance?.RefreshVitals(playerVitals);
        playerVitals.OnStaminaChanged += _ => HUD.Instance?.RefreshVitals(playerVitals);
        playerVitals.OnHeartsChanged += _ => HUD.Instance?.RefreshVitals(playerVitals);
        playerVitals.OnDeath += OnPlayerDeath;
    }

    private void OnPlayerDeath()
    {
        StartCoroutine(HandleDeath());
    }

    private IEnumerator HandleDeath()
    {
        yield return new WaitForSeconds(1.5f); // brief death pause
        playerVitals.ApplyDeath();

        // Respawn at random location
        var spawn = MapBounds.Instance.RandomPointOnMap();
        PlayerController.Instance.transform.position = spawn + Vector3.up;

        // Re-roll weapon for new mana level
        var weapon = GetWeaponForMana(playerVitals.Mana);
        playerWeapon.EquipByName(weapon);
        HUD.Instance?.SetWeapon(weapon, playerWeapon.Current.tier);
        HUD.Instance?.RefreshVitals(playerVitals);
    }

    private string GetWeaponForMana(int mana)
    {
        var tiers = GameConstants.Data != null ? null : null; // use WeaponStats
        foreach (var w in PlayerWeapon.AllWeapons)
        {
            // Pick random from matching tier
        }
        // Fallback
        return "Sword";
    }

    void OnApplicationPause(bool paused)
    {
        if (paused) StartCoroutine(ApiClient.Instance.EndSession(null));
    }

    void OnApplicationQuit()
    {
        StartCoroutine(ApiClient.Instance.EndSession(null));
    }
}
```

- [ ] **Step 3: Fix `GetWeaponForMana` in GameManager**

Replace the stub `GetWeaponForMana` method:

```csharp
private string GetWeaponForMana(int mana)
{
    // Find highest tier whose minMana <= mana
    WeaponStats bestTier = PlayerWeapon.AllWeapons[0];
    foreach (var w in PlayerWeapon.AllWeapons)
        if (mana >= w.attackRange) { } // use tier boundary lookup

    // Collect all weapons matching the correct tier
    int tier = 1;
    foreach (var w in PlayerWeapon.AllWeapons)
    {
        if (mana >= 100000) { tier = 9; break; }
        else if (mana >= 50000) { tier = 8; break; }
        else if (mana >= 10000) { tier = 7; break; }
        else if (mana >= 5000) { tier = 6; break; }
        else if (mana >= 1000) { tier = 5; break; }
        else if (mana >= 700) { tier = 4; break; }
        else if (mana >= 400) { tier = 3; break; }
        else if (mana >= 200) { tier = 2; break; }
        else { tier = 1; break; }
    }

    var candidates = System.Array.FindAll(PlayerWeapon.AllWeapons, w => w.tier == tier);
    if (candidates.Length == 0) return "Sword";
    return candidates[UnityEngine.Random.Range(0, candidates.Length)].name;
}
```

- [ ] **Step 4: Commit**

```bash
git add . && git commit -m "feat: GameManager session lifecycle and death/respawn"
```

---

## Task 13: Onboarding flow & paywall

**Files:**
- Create: `Assets/Scripts/UI/OnboardingFlow.cs`
- Create: `Assets/Scripts/UI/NicknamePanel.cs`
- Create: `Assets/Scripts/UI/PaywallPanel.cs`
- Create: `Assets/Scripts/Subscriptions/SubscriptionManager.cs`
- Create: `Assets/Scenes/Bootstrap.unity`
- Create: `Assets/Scenes/Onboarding.unity`

- [ ] **Step 1: Install RevenueCat Unity SDK**

Download the RevenueCat Unity SDK `.unitypackage` from https://github.com/RevenueCat/purchases-unity and import it into the project.

- [ ] **Step 2: Create `Assets/Scripts/Subscriptions/SubscriptionManager.cs`**

```csharp
using System;
using UnityEngine;

public class SubscriptionManager : MonoBehaviour
{
    public static SubscriptionManager Instance { get; private set; }

    [SerializeField] private string revenueCatApiKey = "appl_XXXXXXXXXXXX"; // set in inspector
    private const string EntitlementId = "metaking_access";

    void Awake()
    {
        if (Instance != null) { Destroy(gameObject); return; }
        Instance = this;
        DontDestroyOnLoad(gameObject);
        // Purchases.Configure(revenueCatApiKey); // uncomment when RC SDK is installed
    }

    public void CheckEntitlement(Action<bool> onResult)
    {
        // TODO: replace with actual RC SDK call when integrated
        // Purchases.GetSharedInstance().GetCustomerInfo((info, error) => {
        //     bool active = info.Entitlements.Active.ContainsKey(EntitlementId);
        //     onResult?.Invoke(active);
        // });

        // Fallback: check via our server endpoint
        CoroutineHelper.Run(ApiClient.Instance.CheckEntitlement(
            res => onResult?.Invoke(res.active),
            _ => onResult?.Invoke(false)));
    }

    public void PurchaseAnnual(Action<bool> onResult)
    {
        // TODO: Purchases.GetSharedInstance().PurchasePackage(annualPackage, ...)
        Debug.Log("[SubscriptionManager] Purchase annual — implement with RC SDK");
        onResult?.Invoke(false);
    }

    public void RestorePurchases(Action<bool> onResult)
    {
        // TODO: Purchases.GetSharedInstance().RestorePurchases(...)
        Debug.Log("[SubscriptionManager] Restore — implement with RC SDK");
        onResult?.Invoke(false);
    }
}
```

- [ ] **Step 3: Create `Assets/Scripts/UI/OnboardingFlow.cs`**

```csharp
using System;
using System.Collections;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class OnboardingFlow : MonoBehaviour
{
    [SerializeField] private GameObject[] screens; // 5 illustrated screens
    [SerializeField] private Button nextButton;
    [SerializeField] private Button skipButton;
    [SerializeField] private NicknamePanel nicknamePanel;
    [SerializeField] private PaywallPanel paywallPanel;

    private int _currentScreen;
    public event Action OnComplete;

    void Start()
    {
        ShowScreen(0);
        nextButton.onClick.AddListener(OnNext);
        skipButton.onClick.AddListener(Skip);
    }

    private void OnNext()
    {
        _currentScreen++;
        if (_currentScreen >= screens.Length)
        {
            gameObject.SetActive(false);
            nicknamePanel.gameObject.SetActive(true);
            nicknamePanel.Show(() =>
            {
                paywallPanel.gameObject.SetActive(true);
                paywallPanel.Show(success => OnComplete?.Invoke());
            });
            return;
        }
        ShowScreen(_currentScreen);
        skipButton.gameObject.SetActive(_currentScreen >= 2);
    }

    private void Skip()
    {
        gameObject.SetActive(false);
        nicknamePanel.gameObject.SetActive(true);
        nicknamePanel.Show(() =>
        {
            paywallPanel.gameObject.SetActive(true);
            paywallPanel.Show(success => OnComplete?.Invoke());
        });
    }

    private void ShowScreen(int index)
    {
        for (int i = 0; i < screens.Length; i++)
            screens[i].SetActive(i == index);
    }
}
```

- [ ] **Step 4: Create `Assets/Scripts/UI/NicknamePanel.cs`**

```csharp
using System;
using System.Collections;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class NicknamePanel : MonoBehaviour
{
    [SerializeField] private TMP_InputField inputField;
    [SerializeField] private Button confirmButton;
    [SerializeField] private TextMeshProUGUI errorLabel;

    private Action _onDone;

    public void Show(Action onDone)
    {
        _onDone = onDone;
        errorLabel.text = "";
        confirmButton.onClick.RemoveAllListeners();
        confirmButton.onClick.AddListener(OnConfirm);
    }

    private void OnConfirm()
    {
        var nick = inputField.text.Trim();
        if (nick.Length < 3 || nick.Length > 16 || !System.Text.RegularExpressions.Regex.IsMatch(nick, @"^[a-zA-Z0-9_]+$"))
        {
            errorLabel.text = "3–16 characters, letters/numbers/underscores only.";
            return;
        }

        confirmButton.interactable = false;
        CoroutineHelper.Run(ApiClient.Instance.SetNickname(nick,
            res =>
            {
                gameObject.SetActive(false);
                _onDone?.Invoke();
            },
            err =>
            {
                errorLabel.text = err.Contains("taken") ? "Nickname already taken." : "Error, try another.";
                confirmButton.interactable = true;
            }));
    }
}
```

- [ ] **Step 5: Create `Assets/Scripts/UI/PaywallPanel.cs`**

```csharp
using System;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class PaywallPanel : MonoBehaviour
{
    [SerializeField] private Button annualButton;  // "Free 3 days, then $X/year"
    [SerializeField] private Button monthlyButton;
    [SerializeField] private Button weeklyButton;
    [SerializeField] private Button restoreButton;
    [SerializeField] private TextMeshProUGUI statusLabel;

    private Action<bool> _onDone;

    public void Show(Action<bool> onDone)
    {
        _onDone = onDone;
        statusLabel.text = "";

        annualButton.onClick.RemoveAllListeners();
        annualButton.onClick.AddListener(() => SubscriptionManager.Instance.PurchaseAnnual(ok => HandleResult(ok)));
        restoreButton.onClick.RemoveAllListeners();
        restoreButton.onClick.AddListener(() => SubscriptionManager.Instance.RestorePurchases(ok => HandleResult(ok)));
    }

    private void HandleResult(bool success)
    {
        if (success)
        {
            gameObject.SetActive(false);
            _onDone?.Invoke(true);
        }
        else
        {
            statusLabel.text = "Purchase failed. Try again.";
        }
    }
}
```

- [ ] **Step 6: Create `Assets/Scenes/Bootstrap.unity`**

In Bootstrap scene, create a `BootstrapController` MonoBehaviour:

```csharp
using System.Collections;
using UnityEngine;
using UnityEngine.SceneManagement;

public class BootstrapController : MonoBehaviour
{
    [SerializeField] private OnboardingFlow onboardingFlow;
    [SerializeField] private GameObject loadingScreen;

    IEnumerator Start()
    {
        loadingScreen.SetActive(true);

        // Sign in with Apple
        bool authDone = false;
        bool authOk = false;
        yield return AuthManager.Instance.SignInWithApple(ok => { authOk = ok; authDone = true; });
        yield return new WaitUntil(() => authDone);

        if (!authOk)
        {
            // Show retry UI
            Debug.LogError("Auth failed");
            yield break;
        }

        // Check if nickname set
        bool meDone = false;
        PlayerMeResponse meData = null;
        yield return ApiClient.Instance.GetPlayerMe(res => { meData = res; meDone = true; }, _ => meDone = true);
        yield return new WaitUntil(() => meDone);

        loadingScreen.SetActive(false);

        bool needsOnboarding = meData?.player?.nickname == null;
        if (needsOnboarding)
        {
            onboardingFlow.gameObject.SetActive(true);
            onboardingFlow.OnComplete += () => SceneManager.LoadScene("Game");
        }
        else
        {
            // Check entitlement
            bool entDone = false;
            bool hasAccess = false;
            SubscriptionManager.Instance.CheckEntitlement(ok => { hasAccess = ok; entDone = true; });
            yield return new WaitUntil(() => entDone);

            if (hasAccess)
                SceneManager.LoadScene("Game");
            else
            {
                // Show paywall
                var paywall = FindObjectOfType<PaywallPanel>();
                paywall?.gameObject.SetActive(true);
                paywall?.Show(ok => { if (ok) SceneManager.LoadScene("Game"); });
            }
        }
    }
}
```

- [ ] **Step 7: Commit**

```bash
git add . && git commit -m "feat: onboarding flow, nickname, paywall, bootstrap scene"
```

---

## Task 14: Visual polish pass

- [ ] **Step 1: Portal particle system polish**

Select Portal prefab → ParticleSystem:
- Shape: Circle, Radius 1.2
- Emission Rate: 40/sec
- Lifetime: 1.5s
- Start Speed: 2, Start Size: 0.15
- Color over Lifetime: purple (alpha 1) → transparent
- Renderer: Additive blending

Add second inner particle system:
- Shape: Sphere, Radius 0.3
- Start Speed: 0.3, Start Size: 0.08
- Color: white → portal color, Additive blending

- [ ] **Step 2: Screen post-processing (URP Volume)**

Add a Global Volume to Game scene:
- Vignette: intensity 0.35, rounded
- Color Grading: Lift (slight blue shadows), Gain (warm highlights), LUT Mode: None
- Bloom: Threshold 1.0, Intensity 0.4 (subtle glow on emissive portals)

- [ ] **Step 3: Warlock death VFX**

When `WarlockAI.Die()` is called, instantiate a particle burst prefab before `Destroy`:

```csharp
[SerializeField] private GameObject deathVfxPrefab;

public void Die()
{
    if (deathVfxPrefab != null)
    {
        var vfx = Instantiate(deathVfxPrefab, transform.position, Quaternion.identity);
        Destroy(vfx, 2f);
    }
    _player.GetComponent<PlayerVitals>()?.KillWarlock();
    Group?.OnWarlockDied(this);
    Destroy(gameObject);
}
```

Death VFX particle: dark purple burst, 20 particles, additive blending, 0.5s lifetime.

- [ ] **Step 4: Heart pickup bobbing animation**

```csharp
// Add to HeartPickup.cs Update():
void Update()
{
    transform.position += Vector3.up * Mathf.Sin(Time.time * 2f) * 0.002f;
    transform.Rotate(Vector3.up, 60f * Time.deltaTime);
}
```

- [ ] **Step 5: MetaKing portal gold crown particle**

When `Portal.Setup()` is called with `isMetaKing = true`, add a second Crown particle system child (golden star particles orbiting the portal ring).

- [ ] **Step 6: Commit**

```bash
git add . && git commit -m "feat: visual polish — particles, post-processing, VFX"
```

---

## Task 15: Leaderboard panel

**Files:**
- Create: `Assets/Scripts/UI/LeaderboardPanel.cs`

- [ ] **Step 1: Create `Assets/Scripts/UI/LeaderboardPanel.cs`**

```csharp
using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class LeaderboardPanel : MonoBehaviour
{
    [SerializeField] private List<TextMeshProUGUI> rankLabels;    // 10 entries
    [SerializeField] private List<TextMeshProUGUI> nameLabels;
    [SerializeField] private List<TextMeshProUGUI> manaLabels;
    [SerializeField] private Button closeButton;

    private float _lastFetch;
    private const float FetchInterval = 300f; // 5 minutes

    void Start() => closeButton.onClick.AddListener(() => gameObject.SetActive(false));

    public void Toggle()
    {
        if (gameObject.activeSelf) { gameObject.SetActive(false); return; }
        gameObject.SetActive(true);
        if (Time.time - _lastFetch > FetchInterval) Refresh();
    }

    private void Refresh()
    {
        _lastFetch = Time.time;
        CoroutineHelper.Run(ApiClient.Instance.GetLeaderboard(
            res => Populate(res.entries),
            err => Debug.LogError($"Leaderboard error: {err}")));
    }

    private void Populate(List<LeaderboardEntry> entries)
    {
        for (int i = 0; i < rankLabels.Count; i++)
        {
            if (i < entries.Count)
            {
                var e = entries[i];
                rankLabels[i].text = e.isMetaKing ? "👑" : $"#{e.rank}";
                nameLabels[i].text = e.nickname;
                manaLabels[i].text = e.mana.ToString("N0");
                nameLabels[i].color = e.isMetaKing ? new Color(1f, 0.84f, 0f) : Color.white;
            }
            else
            {
                rankLabels[i].text = nameLabels[i].text = manaLabels[i].text = "";
            }
        }
    }
}
```

- [ ] **Step 2: Build leaderboard UI panel**

1. Create panel GameObject (dark semi-transparent background, rounded corners).
2. 10 rows, each: rank label (left), nickname (centre), mana (right).
3. Close button top-right.
4. Title: "MetaKing Leaderboard 👑"

- [ ] **Step 3: Commit**

```bash
git add . && git commit -m "feat: leaderboard panel"
```

---

## Task 16: iOS build configuration

- [ ] **Step 1: Configure iOS build settings**

Edit → Project Settings → Player → iOS:
- Bundle ID: `gg.ludex.metaking`
- Display Name: `MetaKing`
- Target minimum iOS version: 16.0
- Architecture: ARM64

- [ ] **Step 2: Add Sign in with Apple capability**

In Xcode after export:
- Target → Signing & Capabilities → + Capability → Sign In with Apple

Or configure via Unity's `Assets/Plugins/iOS` with entitlements plist.

- [ ] **Step 3: Configure RevenueCat**

1. In `SubscriptionManager.cs`, replace `revenueCatApiKey` with actual key from RevenueCat dashboard.
2. Uncomment `Purchases.Configure(revenueCatApiKey)` once SDK is installed.
3. Create products in App Store Connect:
   - `metaking_annual` — Auto-Renewable Subscription, 3-day free trial
   - `metaking_monthly` — Auto-Renewable Subscription
   - `metaking_weekly` — Auto-Renewable Subscription
4. Add products to RevenueCat dashboard, create entitlement `metaking_access` linked to all three.

- [ ] **Step 4: Test on device**

File → Build Settings → iOS → Build. Open Xcode, select your device, Run.
Verify: app launches, Sign in with Apple prompt appears, onboarding loads, game scene loads.

- [ ] **Step 5: Final commit**

```bash
git add . && git commit -m "feat: Unity client complete — iOS build configured"
```

---

## EditMode Test Checklist

All tests runnable via Unity Test Runner → EditMode:

- [ ] `PlayerVitalsTests` — 8 tests (damage, stamina floor, death, portal)
- [ ] `WeaponTierTests` — add to `Assets/Tests/EditMode/WeaponTierTests.cs`:

```csharp
using NUnit.Framework;

public class WeaponTierTests
{
    [Test]
    public void Sword_IsInTier1Pool()
    {
        bool found = false;
        foreach (var w in PlayerWeapon.AllWeapons)
            if (w.name == "Sword" && w.tier == 1) found = true;
        Assert.IsTrue(found);
    }

    [Test]
    public void MetaKingBlade_IsOnlyTier9Weapon()
    {
        int tier9Count = 0;
        foreach (var w in PlayerWeapon.AllWeapons)
            if (w.tier == 9) tier9Count++;
        Assert.AreEqual(1, tier9Count);
    }

    [Test]
    public void AllWeaponsHavePositiveAttackStats()
    {
        foreach (var w in PlayerWeapon.AllWeapons)
        {
            Assert.Greater(w.attackRange, 0, $"{w.name} has zero attackRange");
            Assert.Greater(w.attackSpeed, 0, $"{w.name} has zero attackSpeed");
        }
    }
}
```
