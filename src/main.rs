use blackhole_ray_marching::*;
use rand::Rng;
use rayon::prelude::*;
use std::io::{stdout, Write};

const BH_M: f64 = 1.0;
const BH_POS: Vector = vec3!(0.0, 0.0, 0.0);

fn ray_color(objects: &[Object], ray: &Ray) -> Color {
    const D_TAU: f64 = 1.0 / 4.0; // 固有時間のステップサイズ

    let mut x = ray.origin;
    let mut v = ray.direction.normalized();
    for _ in 0..1_000 {
        let dx = x - BH_POS;
        let r = dx.norm();

        // ブラックホールに吸い込まれる場合は黒色
        if r < 1.5 * BH_M {
            return vec3!(0.0, 0.0, 0.0);
        }

        // Compute accelerations in Cartesian coordinates
        let a = dx * (-BH_M / r.powi(3) + (2.0 * BH_M / r.powi(3)) * v.dot(&dx) / r.powi(2));

        // update
        let past_x = x;
        v += a * D_TAU;
        x += v * D_TAU;

        for object in objects {
            if object.sphere.hit(past_x, x) {
                return object.color;
            }
        }
    }
    vec3!(0.0, 0.0, 1.0)
}

#[derive(Debug, Clone)]
pub struct Object {
    sphere: Sphere,
    color: Color,
}

fn make_scene<R: Rng>(rng: &mut R) -> Vec<Object> {
    let mut objects = Vec::<Object>::new();
    'OUT: for _ in 0..60 {
        let center = Vector::random_in_unit_sphere(rng) * 20.0;
        if center.z() < -10.0 {
            continue;
        }
        let radius = rng.random_range(0.0..1.0) * 3.0;
        if (center - BH_POS).norm() < 2.0 * BH_M + radius {
            continue;
        }
        for object in objects.iter() {
            if (object.sphere.center - center).norm() < object.sphere.radius + radius {
                continue 'OUT;
            }
        }
        objects.push(Object {
            sphere: Sphere::new(center, radius),
            color: Vector::random_in_unit_sphere(rng) * 0.4 + 0.6,
        });
    }
    objects
}

fn main() {
    let stdout = stdout();
    let mut cout = stdout.lock();
    let mut rng = rand_pcg::Mcg128Xsl64::new(12345);

    // camera
    let camera = CameraBuilder::new()
        .look_from(vec3!(0.0, 0.0, -15.0))
        .loot_at(vec3!(0.0))
        .vertical_field_of_view(60.0)
        .aspect_ratio(3.0 / 2.0)
        .pin_hole();

    // image
    let width = 1200_u32;
    let height = (width as f64 / camera.aspect_ratio()).floor() as u32;

    // objects
    let world = make_scene(&mut rng);
    eprintln!("make world done");

    // render
    let mut pixels = Vec::with_capacity(width as usize * height as usize);
    for y in (0..height).rev() {
        for x in 0..width {
            pixels.push((y, x));
        }
    }
    let colors = pixels
        .par_iter()
        .map(|&(y, x)| {
            let u = x as f64 / (width as f64 - 1.0);
            let v = y as f64 / (height as f64 - 1.0);
            let ray = camera.get_ray(u, v);
            ray_color(&world, &ray)
        })
        .collect::<Vec<_>>();

    // save as ppm
    writeln!(cout, "P3").unwrap();
    writeln!(cout, "{} {}", width, height).unwrap();
    writeln!(cout, "255").unwrap();
    for color in colors {
        write_color(&mut cout, color).unwrap()
    }
}
